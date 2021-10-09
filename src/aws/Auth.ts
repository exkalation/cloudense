import { fromIni } from '@aws-sdk/credential-providers';
import { SourceProfileInit } from '@aws-sdk/util-credentials';

export interface Config {
	type: string,
	options: SourceProfileInit
}

export function getCredentials(config: Config){
	return config.type === 'fromIni' ? fromIni(config.options) : null
}
