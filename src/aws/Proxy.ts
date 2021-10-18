import { addProxyToClient } from 'aws-sdk-v3-proxy';
import { ClientWithConfig } from 'aws-sdk-v3-proxy/lib/src/types';

export interface Config {
  enabled: boolean;
  options: Options;
}

export interface Options {
  httpsOnly: boolean;
}

export const proxyClient = <T>(client: ClientWithConfig<T>, proxy: Config): T => {
  return proxy.enabled ? addProxyToClient(client, proxy.options) : client;
};
