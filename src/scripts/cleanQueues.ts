import { getAllQueues } from '../DB/bullMQ';
import { connectToRedis, disconnectRedis } from '../DB/redis';
import colors from 'colors';
import readline from 'readline';

const rl = readline.createInterface({
     input: process.stdin,
     output: process.stdout,
});

function question(query: string): Promise<string> {
     return new Promise((resolve) => rl.question(query, resolve));
}

async function main() {
     console.log(colors.bgYellow.black('\nQueue Cleanup Utility (ENG Backend)\n'));

     try {
          await connectToRedis();

          console.log('Select cleanup option:');
          console.log('1. Clean completed jobs (older than 24h)');
          console.log('2. Clean failed jobs (older than 7 days)');
          console.log('3. Clear/obliterate all queues completely (CRITICAL: Removes ALL waiting, active, failed, and completed jobs!)');

          const choice = await question('\nEnter choice (1, 2, or 3): ');

          const queues = getAllQueues();

          if (choice === '1') {
               const hours = 24;
               console.log(colors.yellow(`\nCleaning completed jobs older than ${hours} hours...`));
               for (const [name, queue] of Object.entries(queues)) {
                    const cleaned = await queue.clean(hours * 60 * 60 * 1000, 100, 'completed');
                    console.log(colors.green(`   ${name}: ${cleaned.length} completed jobs cleaned`));
               }
          } else if (choice === '2') {
               const days = 7;
               console.log(colors.yellow(`\nCleaning failed jobs older than ${days} days...`));
               for (const [name, queue] of Object.entries(queues)) {
                    const cleaned = await queue.clean(days * 24 * 60 * 60 * 1000, 100, 'failed');
                    console.log(colors.green(`   ${name}: ${cleaned.length} failed jobs cleaned`));
               }
          } else if (choice === '3') {
               const confirm = await question(colors.red('\nWARNING: This will permanently delete all waiting and active jobs. Are you sure? (yes/no): '));
               if (confirm.toLowerCase() === 'yes') {
                    console.log(colors.yellow('\nObliterating all queues...'));
                    for (const [name, queue] of Object.entries(queues)) {
                         await queue.obliterate({ force: true });
                         console.log(colors.red(`   ${name} queue obliterated`));
                    }
               } else {
                    console.log(colors.yellow('\nObliterate cancelled.'));
               }
          } else {
               console.log(colors.red('\nInvalid choice.'));
          }

          console.log(colors.bgGreen.black('\nOperation Complete\n'));
          await disconnectRedis();
          rl.close();
          process.exit(0);
     } catch (error) {
          console.error(colors.red('Cleanup failed:'), error);
          await disconnectRedis();
          rl.close();
          process.exit(1);
     }
}

main();
