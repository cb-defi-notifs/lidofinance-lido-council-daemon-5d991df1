import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
// import * as net from 'net';
import { exec } from 'child_process';

export class HardhatServer {
  private hardhatProcess: ChildProcessWithoutNullStreams | null = null;
  private ready = false;

  // Method to start Hardhat and wait until it's ready
  public async start() {
    // await this.checkPort(8545);
    return new Promise<void>((resolve, reject) => {
      this.hardhatProcess = spawn('npx', [
        'hardhat',
        'node',
        '--hostname',
        '0.0.0.0',
      ]);

      if (!this.hardhatProcess) {
        return reject(new Error('Failed to start Hardhat process'));
      }

      // Log the PID of the started process
      console.log(
        `Hardhat process started with PID: ${this.hardhatProcess.pid}`,
      );

      // Listen for stdout to detect when Hardhat is ready
      this.hardhatProcess.stdout.on('data', (data) => {
        const output = data.toString();
        // console.log(`Hardhat stdout: ${output}`);

        // Check for the Hardhat ready message
        if (output.includes('Started HTTP and WebSocket JSON-RPC server')) {
          this.ready = true;
          resolve();
        }
      });

      // Listen for errors
      this.hardhatProcess.stderr.on('data', (data) => {
        console.error(`Hardhat stderr: ${data}`);
      });

      this.hardhatProcess.on('error', (error) => {
        console.error(`Failed to start Hardhat: ${error}`);
        reject(error);
      });

      this.hardhatProcess.on('close', (code) => {
        if (code !== 0 && !this.ready) {
          reject(
            new Error(`Hardhat process exited unexpectedly with code ${code}`),
          );
        }
      });
    });
  }

  public async stop() {
    if (this.hardhatProcess) {
      try {
        // const stillRunning = this.hardhatProcess && !this.hardhatProcess.killed;

        await this.forceKillPort(this.hardhatProcess, 8545);

        // if (stillRunning) {
        //   console.warn('Hardhat process did not terminate as expected.');
        // } else {
        //   console.log('Hardhat process killed successfully.');

        //   await this.checkPort(8545);
        // }
      } catch (error) {
        console.error(
          'Error occurred while stopping the Hardhat process:',
          error,
        );
      }
    } else {
      console.log('No Hardhat process to stop.');
    }
  }

  // async checkPort(port: number): Promise<void> {
  //   return new Promise((resolve, reject) => {
  //     const client = net.createConnection({ port }, () => {
  //       console.warn(
  //         `Port ${port} is still open. Process may not have terminated correctly.`,
  //       );
  //       client.end();
  //       reject(new Error(`Port ${port} is still in use.`));
  //     });

  //     client.on('error', () => {
  //       console.log(`Port ${port} is closed as expected.`);
  //       resolve();
  //     });

  //     client.setTimeout(1000, () => {
  //       console.warn(
  //         `Timeout while checking port ${port}. Assuming it's closed.`,
  //       );
  //       client.end();
  //       resolve();
  //     });
  //   });
  // }

  // Additional method to force-kill any process on a specific port (Linux-only)
  private async forceKillPort(hardhatProcess, port: number): Promise<void> {
    // Attempt to kill the process
    hardhatProcess.kill('SIGTERM');

    await new Promise((resolve) => setTimeout(resolve, 100));

    if (process.platform !== 'linux') return;

    return new Promise((resolve) => {
      exec(
        `lsof -i :${port} | awk 'NR!=1 {print $2}' | xargs kill -9`,
        (error, stdout, stderr) => {
          if (error) {
            console.warn(
              `Failed to force-kill processes on port ${port}: ${error}`,
            );
          } else if (stderr) {
            console.warn(`Standard error from force-kill command: ${stderr}`);
          } else {
            console.log(`Successfully force-killed processes on port ${port}`);
          }
          resolve();
        },
      );
    });
  }
}
