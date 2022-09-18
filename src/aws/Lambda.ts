import {
  LambdaClient,
  GetFunctionConfigurationCommand,
  GetFunctionConfigurationCommandOutput,
  UpdateFunctionCodeCommand,
  PublishVersionCommand,
  LastUpdateStatus,
} from '@aws-sdk/client-lambda';
import { Buffer } from 'buffer';
import * as fs from 'fs/promises';
import * as Auth from './Auth';
import * as Proxy from './Proxy';

export interface Config {
  region: string;
  auth: Auth.Config;
  proxy: Proxy.Config;
}

export enum Publish {
  Never = 'NEVER',
  WhenChanged = 'WHEN_CHANGED',
  Force = 'FORCE',
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
    .then(publishOrReject(Publish.Force))
    .then(publishVersion(client, description))
    .catch((err) => {
      if (err === Publish.Never) {
        return Promise.resolve('');
      }
      return Promise.reject(err);
    });
};

const publishVersion =
  (client: LambdaClient, description: string) =>
  async (functionData: GetFunctionConfigurationCommandOutput): Promise<string> => {
    if (!functionData.FunctionName) {
      throw 'No function name in function configuration.';
    }

    return awaitStatusSuccess(client, functionData.FunctionName, 100).then(async (functionData) => {
      const publishVersionCommand = new PublishVersionCommand({
        FunctionName: functionData.FunctionName,
        RevisionId: functionData.RevisionId,
        Description: description,
      });
      return client.send(publishVersionCommand).then((functionData) => {
        if (!functionData.Version) {
          throw 'Publish version failed: Could not retrieve new version';
        }
        console.log('Function published. Version', functionData.Version);
        return functionData.Version;
      });
    });
  };

const awaitStatusSuccess = async (
  client: LambdaClient,
  functionName: string,
  tries: number = 1,
  interval: number = 5000
): Promise<GetFunctionConfigurationCommandOutput> => {
  return getFunctionConfig(client)(functionName).then((response) => {
    if (tries <= 0) {
      throw 'Retries exhausted while waiting for status "Success", giving up.';
    }
    if (response.LastUpdateStatus === LastUpdateStatus.Failed) {
      throw 'Encountered status "Failed" while waiting for LastUpdateStatus "Success", terminating.';
    }

    const status: string = response && response.LastUpdateStatus ? response.LastUpdateStatus : 'Could not read status';
    if (status === LastUpdateStatus.Successful) {
      console.log(`Function status: ${status}. Continuing.`);
      return Promise.resolve(response);
    }
    console.log(`Function status: ${status}. Checking again in ${interval}ms. ${tries} tries left.`);
    return new Promise((resolve) =>
      setTimeout(() => resolve(awaitStatusSuccess(client, functionName, tries - 1, interval)), interval)
    );
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
    console.log('Deploying function to Lambda...');
    return client.send(updateCodeCommand).then((newFunctionData) => {
      console.log('Function deployed. RevisionId', newFunctionData.RevisionId);
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

const checkFunction =
  (client: LambdaClient) =>
  async (functionName: string): Promise<GetFunctionConfigurationCommandOutput> => {
    console.log('Checking if function exists.');
    return getFunctionConfig(client)(functionName).then((response) => {
      console.log(
        'Found function. Version',
        response.Version,
        'RevisionId',
        response.RevisionId,
        'CodeSha256',
        response.CodeSha256
      );
      return response;
    });
  };

const getFunctionConfig =
  (client: LambdaClient) =>
  async (functionName: string): Promise<GetFunctionConfigurationCommandOutput> => {
    const getFunctionConfigCommand = new GetFunctionConfigurationCommand({
      FunctionName: functionName,
    });
    return client.send(getFunctionConfigCommand);
  };

const readZipAsBuffer = async (path: string): Promise<Buffer> => {
  console.info('Reading ZIP file...');
  return fs
    .readFile(path)
    .then(Buffer.from)
    .then((fileBuffer: Buffer) => {
      console.log('File read.');
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
