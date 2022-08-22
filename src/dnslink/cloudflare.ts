import { fetch, getDomain } from '../deps';

interface CloudflareConfig {
  token: string;
}

async function request(
  url: string,
  opts: { method?: string; body?: object } & CloudflareConfig
) {
  const init = {
    method: opts.method,
    headers: {
      Authorization: `Bearer ${opts.token}`,
      'Content-Type': 'application/json',
    },
    body: opts.body == null ? null : JSON.stringify(opts.body),
  };
  const res = await fetch(url, init);
  const data = await res.json();
  if (!res.ok) throw { status: res.status, data };
  return data;
}

async function findZone(name: string, config: CloudflareConfig) {
  const {
    result: [zone],
  } = await request(
    `https://api.cloudflare.com/client/v4/zones?name=${name}`,
    config
  );
  return zone;
}

async function findRecord(
  zoneId: string,
  name: string,
  config: CloudflareConfig
) {
  const {
    result: [record],
  } = await request(
    `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records?name=${name}&type=TXT`,
    config
  );
  return record;
}

async function createRecord(
  zoneId: string,
  name: string,
  content: string,
  config: CloudflareConfig
) {
  await request(
    `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records`,
    {
      ...config,
      method: 'POST',
      body: {
        type: 'TXT',
        name,
        content,
        ttl: 1,
      },
    }
  );
}

async function updateRecord(
  zoneId: string,
  recordId: string,
  content: string,
  config: CloudflareConfig
) {
  await request(
    `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records/${recordId}`,
    {
      ...config,
      method: 'PATCH',
      body: {
        content,
      },
    }
  );
}

export async function updateDNSLink(
  hostname: string,
  ipfsPath: string,
  configObj: unknown
) {
  const config = configObj as CloudflareConfig;
  if (!config.token) throw new Error('`token` is required for Cloudflare');
  const name = `_dnslink.${hostname}`;
  const content = `dnslink=${ipfsPath}`;
  const domain = getDomain(hostname);
  const zone = await findZone(domain, config);
  const record = await findRecord(zone.id, name, config);
  if (record) {
    await updateRecord(zone.id, record.id, content, config);
  } else {
    await createRecord(zone.id, name, content, config);
  }
}
