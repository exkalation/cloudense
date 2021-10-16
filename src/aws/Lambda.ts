import {
  LambdaClient,
  GetFunctionConfigurationCommand,
  GetFunctionConfigurationCommandOutput,
  UpdateFunctionCodeCommand,
  PublishVersionCommand,
} from "@aws-sdk/client-lambda";
import { Buffer } from "buffer";
import * as Auth from "./Auth";
import * as Proxy from "./Proxy";
import * as fs from "fs/promises";

export interface Config {
  region: string;
  auth: Auth.Config;
  proxy: Proxy.Config;
}

export enum Publish {
  Never = "NEVER",
  WhenChanged = "WHEN_CHANGED",
  Force = "FORCE",
}

export const deployFunction = async (
  config: Config,
  functionName: string,
  description: string,
  zipFile: string,
  publish: Publish = Publish.WhenChanged
): Promise<string> => {
  const client = getLambdaClient(config);
  const filePromise = readZipAsBuffer(zipFile);
  const checkPromise = checkFunction(client)(functionName);

  return Promise.all([filePromise, checkPromise])
    .then(deployCode(client))
    .then(publishOrReject(publish))
    .then(publishVersion(client, description))
    .catch((err) => {
      if (err === Publish.Never) {
        return Promise.resolve("");
      }
      return Promise.reject(err);
    });
};

const publishVersion =
  (client: LambdaClient, description: string) =>
  async (newFunctionData: GetFunctionConfigurationCommandOutput): Promise<string> => {
    const publishVersionCommand = new PublishVersionCommand({
      FunctionName: newFunctionData.FunctionName,
      RevisionId: newFunctionData.RevisionId,
      Description: description,
    });

    return client.send(publishVersionCommand).then((newFunctionData) => {
      if (!newFunctionData.Version) {
        throw "Publish version failed: Could not retrieve new version";
      }
      console.log("Function published. Version", newFunctionData.Version);
      return newFunctionData.Version;
    });
  };

const deployCode =
  (client: LambdaClient) =>
  async ([fileBuffer, lastFunctionData]: [Buffer, GetFunctionConfigurationCommandOutput]): Promise<
    [GetFunctionConfigurationCommandOutput, GetFunctionConfigurationCommandOutput]
  > => {
    const updateCodeCommand = new UpdateFunctionCodeCommand({
      FunctionName: lastFunctionData.FunctionName,
      ZipFile: fileBuffer,
    });
    console.log("Deploying function to Lambda...");
    return client.send(updateCodeCommand).then((newFunctionData) => {
      console.log("Function deployed. RevisionId", newFunctionData.RevisionId);
      return [lastFunctionData, newFunctionData];
    });
  };

const publishOrReject =
  (publish: Publish) =>
  async ([lastFunctionData, newFunctionData]: [
    GetFunctionConfigurationCommandOutput,
    GetFunctionConfigurationCommandOutput
  ]): Promise<GetFunctionConfigurationCommandOutput> => {
    if (publish === Publish.Never) {
      return Promise.reject(Publish.Never);
    }
    if (publish === Publish.Force) {
      return Promise.resolve(newFunctionData);
    }

    if (lastFunctionData.CodeSha256 === newFunctionData.CodeSha256) {
      return Promise.reject(Publish.WhenChanged);
    }
    return Promise.resolve(newFunctionData);
  };

const checkFunction = (client: LambdaClient) => async (functionName: string) => {
  console.log("Checking if function exists.");
  const checkFunctionCommand = new GetFunctionConfigurationCommand({
    FunctionName: functionName,
  });
  return client.send(checkFunctionCommand).then((response) => {
    console.log(
      "Found function. Version",
      response.Version,
      "RevisionId",
      response.RevisionId,
      "CodeSha256",
      response.CodeSha256
    );
    return response;
  });
};

const readZipAsBuffer = async (path: string): Promise<Buffer> => {
  console.log("Reading ZIP file...");
  return fs
    .readFile(path)
    .then(Buffer.from)
    .then((fileBuffer: Buffer) => {
      console.log("File read.");
      return fileBuffer;
    });
};

const getLambdaClient = (config: Config): LambdaClient => {
  const clientConfig = {
    region: config.region,
    credentials: Auth.getCredentials(config.auth),
  };
  return Proxy.proxyClient(new LambdaClient(clientConfig), config.proxy);
};
