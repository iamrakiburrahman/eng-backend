import { getAllQueuesStats } from '../DB/bullMQ';
import { connectToRedis, disconnectRedis } from '../DB/redis';
import colors from 'colors';

async function main() {
     try {
          await connectToRedis();
          const stats = await getAllQueuesStats();
          console.log(colors.bgBlue.white('\nBULLMQ QUEUE STATS:\n'));
          console.table(stats);
          await disconnectRedis();
          process.exit(0);
     } catch (error) {
          console.error(error);
          process.exit(1);
     }
}

main();
