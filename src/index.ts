import { getInput, setFailed, info, saveState } from '@actions/core';
import { exec } from '@actions/exec';
import { rmRF } from '@actions/io';

const start_timeout = 100;
const system_github_repo = 'https://github.com/restorecommerce/system.git';
const data_github_repo = 'https://github.com/restorecommerce/data.git';

const backingOnly = getInput('backing-only').toLowerCase() === 'true';
const importData = getInput('import').toLowerCase() === 'true';
const shutdown = getInput('shutdown').toLowerCase();

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
      cwd: 'system/Docker-Compose'
    };
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
      if ('State' in inspect && 'Health' in inspect['State']) {
        return new Promise(async (resolve, reject) => {
          for (let i = 0; i < start_timeout; i++) {
            let out = '';
            await exec('docker', ['inspect', inspect['Id']], {
              listeners: {
                stdout: (data: Buffer) => out += data.toString()
              },
              silent: true
            }).catch();

            const state = JSON.parse(out)[0]['State'];
            if ('Health' in state && state['Health']['Status'] === 'healthy') {
              info('Service ' + inspect['Name'].substr(1) + ' is up');
              resolve(true);
              return;
            }

            await new Promise(r => setTimeout(r, 1000));
          }

          let containerLogs = '';
          await exec('docker', ['logs', inspect['Name'].substr(1)], {
            listeners: {
              stdout: (data: Buffer) => containerLogs += data.toString()
            },
            silent: true
          });

          info(containerLogs);
          info(JSON.stringify(inspect));

          const errorMessage = 'Timed out waiting for service to start up: ' + inspect['Name'];
          setFailed(errorMessage);
          reject(errorMessage);
        });
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

      // TODO Pull API key from facade-srv logs
      const apiKey = 'api_key';
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
      cwd: 'system/Docker-Compose'
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
