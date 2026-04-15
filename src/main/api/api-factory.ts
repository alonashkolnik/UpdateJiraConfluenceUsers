import { Session } from 'electron';
import type { InstanceType } from '../../shared/types';
import type { IAtlassianApi } from './types';
import { ApiClient } from './api-client';
import { CloudApi } from './cloud-api';
import { JiraDcApi } from './jira-dc-api';
import { ConfluenceDcApi } from './confluence-dc-api';

/** Active API instances keyed by baseUrl */
const apiInstances = new Map<string, IAtlassianApi>();
const clientInstances = new Map<string, ApiClient>();

export async function createApi(
  instanceType: InstanceType,
  baseUrl: string,
  session: Session
): Promise<IAtlassianApi> {
  const client = new ApiClient(baseUrl, session);
  clientInstances.set(baseUrl, client);

  let api: IAtlassianApi;

  switch (instanceType) {
    case 'cloud':
      api = new CloudApi(client);
      break;
    case 'jira-dc':
      api = new JiraDcApi(client);
      break;
    case 'confluence-dc': {
      const confApi = new ConfluenceDcApi(client);
      await confApi.init(); // Detect /wiki prefix
      api = confApi;
      break;
    }
  }

  apiInstances.set(baseUrl, api);
  return api;
}

export function getApi(baseUrl: string): IAtlassianApi | null {
  return apiInstances.get(baseUrl) ?? null;
}

export function getClient(baseUrl: string): ApiClient | null {
  return clientInstances.get(baseUrl) ?? null;
}

export function clearApi(baseUrl: string): void {
  apiInstances.delete(baseUrl);
  clientInstances.delete(baseUrl);
}
