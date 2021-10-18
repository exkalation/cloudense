import { fromIni } from '@aws-sdk/credential-providers';
import { SourceProfileInit } from '@aws-sdk/util-credentials';
import { CredentialProvider } from '@aws-sdk/types';

export interface Config {
  type: string;
  options: SourceProfileInit;
}

export const getCredentials = (config: Config): CredentialProvider => {
  if (config.type === 'fromIni') return fromIni(config.options);
  throw 'Authentication failed: Could not get credentials.';
};
