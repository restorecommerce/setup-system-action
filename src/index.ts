import { getInput, setFailed, info, saveState } from '@actions/core';
import { downloadTool } from '@actions/tool-cache';
import { exec } from '@actions/exec';
import { rmRF } from '@actions/io';
import { chmod } from 'fs/promises';

const start_timeout = 300;
const system_github_repo = 'https://github.com/restorecommerce/system.git';
const data_github_repo = 'https://github.com/restorecommerce/data.git';

const backingOnly = getInput('backing-only').toLowerCase() === 'true';
const importData = getInput('import').toLowerCase() === 'true';
const shutdown = getInput('shutdown').toLowerCase();

const GRPC_PROBE_VERSION = 'v0.4.21';
const GRPC_PROBE_URL = `https://github.com/grpc-ecosystem/grpc-health-probe/releases/download/${GRPC_PROBE_VERSION}/grpc_health_probe-linux-amd64`;

const grpcProbeServices = {
  restorecommerce_identity_srv: 50051,
  restorecommerce_notification_srv: 50052,
  restorecommerce_ostorage_srv: 50066,
  restorecommerce_ordering_srv: 50065,
  restorecommerce_catalog_srv: 50068,
  restorecommerce_resource_srv: 50053,
  restorecommerce_scheduling_srv: 50054,
  restorecommerce_rendering_srv: 50057,
  restorecommerce_access_control_srv: 50061,
  restorecommerce_fulfillment_srv: 50067,
};

const FACADE_SERVER_NAME = 'restorecommerce_facade_srv';

const probePath = downloadTool(GRPC_PROBE_URL).then((p) => chmod(p, 0o777).then(() => p));

const grpcHealthProbe = async (container: string) => {
  return await exec(await probePath, [`-addr=:${grpcProbeServices[container]}`], {
    silent: true
  }).catch(c => c) === 0;
};

const isContainerHealthy = async (container: string) => {
  let out = '';
  await exec('docker', ['inspect', container], {
    listeners: {
      stdout: (data: Buffer) => out += data.toString(),
    },
    silent: true
  }).catch(console.error);

  const parsed = JSON.parse(out);
  if (parsed && parsed.length > 0) {
    const state = parsed[0]['State'];
    if ('Health' in state && state['Health']['Status'] === 'healthy') {
      return true;
    }
  }

  return false;
};

const getFacadeAPIKey = async () => {
  let out = '';
  await exec('docker', ['logs', FACADE_SERVER_NAME], {
    listeners: {
      stdout: (data: Buffer) => out += data.toString(),
      stderr: (data: Buffer) => out += data.toString(),
    },
    silent: true
  }).catch(console.error);

  const line = out.split('\n').find(line => {
    if (line.indexOf('Bootstrap API Key is') >= 0) {
      return true;
    }
  });

  if (line) {
    const words = line.split(' ');
    return words[words.length - 1];
  }

  return undefined;
};

const waitForHealthy = async (containerName: string) => {
  return new Promise(async (resolve, reject) => {
    for (let i = 0; i < start_timeout; i++) {
      if (containerName in grpcProbeServices) {
        if (await grpcHealthProbe(containerName)) {
          info('Service ' + containerName + ' is up');
          resolve(true);
          return;
        }
      } else {
        if (await isContainerHealthy(containerName)) {
          info('Service ' + containerName + ' is up');
          resolve(true);
          return;
        }
      }

      await new Promise(r => setTimeout(r, 1000));
    }

    let containerLogs = '';
    await exec('docker', ['logs', containerName], {
      listeners: {
        stdout: (data: Buffer) => containerLogs += data.toString()
      },
      silent: true
    });

    info(containerLogs);

    const errorMessage = 'Timed out waiting for service to start up: ' + containerName;
    setFailed(errorMessage);
    reject(errorMessage);
  });
};

const setup = async () => {
  try {
    await exec('docker', ['version']);
    await exec('docker-compose', ['version']);

    if (backingOnly) {
      info('Setting up system backing services');
    } else {
      info('Setting up full system stack');
    }

    info('Cloning repository from: ' + system_github_repo);

    await exec('git', ['clone', system_github_repo]);

    info('Bringing up via docker-compose');

    let script = 'backing.bash';
    if (!backingOnly) {
      script = 'all.bash';
    }

    const systemConfig = {
      cwd: 'system/docker'
    };
    await exec('bash', [script, 'pull', '-q'], systemConfig);
    await exec('bash', [script, 'up', '-d'], systemConfig);

    let containers = '';
    await exec('bash', [script, 'ps', '-q'], {
      ...systemConfig,
      listeners: {
        stdout: (data: Buffer) => containers += data.toString()
      },
      silent: true
    });

    let inspect = '';
    await exec('docker', ['inspect', ...containers.trim().split('\n')], {
      listeners: {
        stdout: (data: Buffer) => inspect += data.toString()
      },
      silent: true
    });

    const inspections = JSON.parse(inspect);

    await Promise.all(inspections.map(async (inspect) => {
      const containerName = inspect['Name'].substring(1);
      if (('State' in inspect && 'Health' in inspect['State']) || containerName in grpcProbeServices) {
        return waitForHealthy(containerName);
      }
    }));

    await exec('bash', [script, 'ps'], systemConfig);

    if (importData) {
      info('Cloning repository from: ' + data_github_repo);

      await exec('git', ['clone', data_github_repo]);

      await exec('npm', ['install'], {
        cwd: 'data/demo-shop'
      });

      info('Importing data');

      let apiKey = await getFacadeAPIKey();
      if (!apiKey) {
        await exec('docker', ['restart', FACADE_SERVER_NAME]);
        await new Promise(r => setTimeout(r, 30000));
        apiKey = await getFacadeAPIKey();
      }

      info(`Retrieved API Key: ${apiKey}`);

      const datasets = ['master', 'identity', 'extra'];

      for (let dataset of datasets) {
        await exec('node', ['import.js', 'import', '-t', apiKey, '-j', dataset], {
          cwd: 'data/demo-shop'
        });
      }
    }

    if (shutdown) {
      const toShutdown = shutdown.trim().split('\n').map(s => s.trim());

      info('Shutting down services: ' + toShutdown.join(', '));

      await exec('bash', [script, 'stop', ...toShutdown], systemConfig);
    }

    await exec('bash', [script, 'ps'], systemConfig);

    info('System setup complete');
  } catch (error) {
    console.log(error);
    setFailed(error.message);
  }
};

const post = async () => {
  try {
    info('Shutting down via docker-compose');

    let script = 'backing.bash';
    if (!backingOnly) {
      script = 'all.bash';
    }

    await exec('bash', [script, 'down'], {
      cwd: 'system/docker'
    });

    await rmRF('system');

    if (importData) {
      await rmRF('data');
    }
  } catch (error) {
    console.log(error);
    setFailed(error.message);
  }
};

const IsPost = !!process.env['STATE_isPost'];

if (!IsPost) {
  saveState('isPost', 'true');
}

if (IsPost) {
  post();
} else {
  setup();
}
