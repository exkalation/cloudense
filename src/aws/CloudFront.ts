import {
  CloudFrontClient,
  GetDistributionConfigCommand,
  GetDistributionConfigCommandOutput,
  CacheBehavior,
  CacheBehaviors,
  GetDistributionCommand,
  LambdaFunctionAssociations,
  LambdaFunctionAssociation,
  DistributionConfig,
  UpdateDistributionCommand,
  UpdateDistributionCommandOutput,
  GetDistributionCommandOutput,
} from "@aws-sdk/client-cloudfront";
import * as Auth from "./Auth";
import * as Proxy from "./Proxy";

export interface Config {
  region: string;
  auth: Auth.Config;
  proxy: Proxy.Config;
}

export interface CacheBehaviorEventDefinition {
  pathPattern: string;
  targetOrigin: string;
  eventType: string;
}

export const getDistributionStatus = (
  config: Config,
  distributionId: string
) => {
  const client: CloudFrontClient = getCloudFrontClient(config);
  console.log("checking status");
  return checkStatus(distributionId, client, 10);
};

export const deployLamdaEdgeFunction = (
  config: Config,
  distributionId: string,
  target: CacheBehaviorEventDefinition,
  arnWithoutVersion: string,
  lambdaFunctionVersion: string
) => {
  const client: CloudFrontClient = getCloudFrontClient(config);
  getDistributionConfig(distributionId, client)
    .then(
      updateCacheBehaviorLambdaFunctionVersion(
        target,
        arnWithoutVersion,
        lambdaFunctionVersion
      )
    )
    .then(deployDistributionConfig(distributionId, client))
    .then((response) => {
      console.log("New distribution config deployed!", response);
      console.log("Waiting for deployment to be replicated to all edge nodes.");
      return checkStatus(distributionId, client, 100, 5000);
    })
    .then((deployed) => {
      if (deployed) {
        console.log("Distribution was deployed successfully!");
      } else {
        console.log("Distribution is still not deployed. Giving up.");
      }
    });
};

const checkStatus = (
  distributionId: string,
  client: CloudFrontClient,
  tries: number = 1,
  interval: number = 5000
) => {
  const command = new GetDistributionCommand({ Id: distributionId });
  return client.send(command).then((response: GetDistributionCommandOutput) => {
    if (tries <= 0) {
      return Promise.resolve(false);
    }
    if (response.Distribution.Status === "Deployed") {
      return Promise.resolve(true);
    }
    console.log(
      "Distribution status:",
      response.Distribution.Status,
      "(Checking again in " + interval + "ms. " + tries + " tries left.)"
    );
    return new Promise((resolve) =>
      setTimeout(
        () => resolve(checkStatus(distributionId, client, tries - 1, interval)),
        interval
      )
    );
  });
};

const deployDistributionConfig =
  (distributionId: string, client: CloudFrontClient) =>
  ([eTag, distributionConfig]: [
    string,
    DistributionConfig
  ]): Promise<UpdateDistributionCommandOutput> => {
    const command = new UpdateDistributionCommand({
      Id: distributionId,
      IfMatch: eTag,
      DistributionConfig: distributionConfig,
    });
    return client.send(command);
  };

const updateCacheBehaviorLambdaFunctionVersion =
  (
    target: CacheBehaviorEventDefinition,
    arnWithoutVersion: string,
    lambdaFunctionVersion: string
  ) =>
  (
    response: GetDistributionConfigCommandOutput
  ): [string, DistributionConfig] => {
    console.log("GetDistributionConfigCommandOutput", response);
    const distributionConfig = response.DistributionConfig;
    console.log(
      "LAMBDA ASSOCIATIONS BEFORE",
      distributionConfig.CacheBehaviors.Items[0].LambdaFunctionAssociations
    );
    distributionConfig.CacheBehaviors = updateCacheBehaviors(
      target,
      arnWithoutVersion,
      lambdaFunctionVersion,
      response.DistributionConfig.CacheBehaviors
    );
    console.log(
      "LAMBDA ASSOCIATIONS AFTER",
      distributionConfig.CacheBehaviors.Items[0].LambdaFunctionAssociations
    );
    return [response.ETag, distributionConfig];
  };

const updateCacheBehaviors = (
  target: CacheBehaviorEventDefinition,
  arnWithoutVersion: string,
  lambdaFunctionVersion: string,
  items: CacheBehaviors
): CacheBehaviors => {
  if (items.Quantity > 0 && items.Items && items.Items.length > 0) {
    items.Items = items.Items.map(
      updateCacheBehavior(target, arnWithoutVersion, lambdaFunctionVersion)
    );
  }
  return items;
};

const updateCacheBehavior =
  (
    target: CacheBehaviorEventDefinition,
    arnWithoutVersion: string,
    lambdaFunctionVersion: string
  ) =>
  (item: CacheBehavior): CacheBehavior => {
    if (
      item.PathPattern === target.pathPattern &&
      item.TargetOriginId === target.targetOrigin
    ) {
      item.LambdaFunctionAssociations = updateLambdaFunctionAssociations(
        arnWithoutVersion,
        lambdaFunctionVersion,
        item.LambdaFunctionAssociations
      );
    }
    return item;
  };

const updateLambdaFunctionAssociations = (
  arnWithoutVersion: string,
  lambdaFunctionVersion: string,
  items: LambdaFunctionAssociations
): LambdaFunctionAssociations => {
  if (items.Quantity > 0 && items.Items && items.Items.length > 0) {
    items.Items = items.Items.map(
      updateLambdaFunctionAssociation(arnWithoutVersion, lambdaFunctionVersion)
    );
  }
  return items;
};

const updateLambdaFunctionAssociation =
  (arnWithoutVersion: string, lambdaFunctionVersion: string) =>
  (item: LambdaFunctionAssociation): LambdaFunctionAssociation => {
    if (
      item.LambdaFunctionARN &&
      item.LambdaFunctionARN.startsWith(arnWithoutVersion)
    ) {
      item.LambdaFunctionARN = arnWithoutVersion + ":" + lambdaFunctionVersion;
    }
    return item;
  };

const getDistributionConfig = (
  distributionId: string,
  client: CloudFrontClient
): Promise<GetDistributionConfigCommandOutput> => {
  const command = new GetDistributionConfigCommand({ Id: distributionId });
  return client.send(command);
};

const getCloudFrontClient = (config: Config): CloudFrontClient => {
  const clientConfig = {
    region: config.region,
    credentials: Auth.getCredentials(config.auth),
  };
  return Proxy.proxyClient(new CloudFrontClient(clientConfig), config.proxy);
};