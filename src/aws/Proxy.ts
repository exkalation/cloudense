import { addProxyToClient } from 'aws-sdk-v3-proxy';

export interface Config {
	enabled: boolean,
	options: Options
}

export interface Options {
	httpsOnly: boolean
}

export function proxyClient<T>(client, proxy: Config): T{
	return proxy.enabled ? addProxyToClient(client, proxy.options) : client;
}
