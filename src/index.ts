import { getInput, setFailed, info } from '@actions/core';
import { exec } from '@actions/exec';
import { rmRF } from '@actions/io';

const start_timeout = 100;
const system_github_repo = 'https://github.com/restorecommerce/system.git';

const setup = async () => {
  try {
    const backing = getInput('backing-only').toLowerCase() !== 'true';

    if (backing) {
      info('Setting up system backing services');
    } else {
      info('Setting up full system stack');
    }

    info('Cloning repository from: ' + system_github_repo);

    await exec('git', ['clone', system_github_repo]);

    info('Bringing up via docker-compose');

    let script = 'backing.bash';
    if (!backing) {
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
      ...systemConfig,
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
              ...systemConfig,
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

          const errorMessage = 'Timed out waiting for service to start up: ' + inspect['Name'];
          setFailed(errorMessage);
          reject(errorMessage);
        });
      }
    }));

    await exec('bash', [script, 'ps'], systemConfig);
  } catch (error) {
    console.log(error);
    setFailed(error.message);
  }
};

const post = async () => {
  try {
    const backing = getInput('backing-only').toLowerCase() !== 'true';

    info('Shutting down via docker-compose');

    let script = 'backing.bash';
    if (!backing) {
      script = 'all.bash';
    }

    await exec('bash', [script, 'down'], {
      cwd: 'system/Docker-Compose'
    });

    await rmRF('system');
  } catch (error) {
    console.log(error);
    setFailed(error.message);
  }
};

if (!!process.env['STATE_isPost']) {
  post();
} else {
  setup();
}
