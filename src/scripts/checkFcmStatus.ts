import mongoose from 'mongoose';

async function run() {
  const uri =
    'mongodb://admin:MostStrongPassword@31.97.117.41:27017/eng?authSource=admin&directConnection=true';
  await mongoose.connect(uri);

  const userCol = mongoose.connection.collection('users');
  const total = await userCol.countDocuments();
  const withToken = await userCol.countDocuments({
    fcmToken: { $exists: true, $nin: [null, ''] },
  });

  console.log({ totalUsers: total, usersWithFcmToken: withToken });

  // Sample a user with FCM token if any
  const sample = await userCol.findOne({
    fcmToken: { $exists: true, $nin: [null, ''] },
  });
  if (sample) {
    console.log('Sample user with token:', {
      _id: sample._id,
      email: sample.email,
      role: sample.role,
      fcmTokenPrefix: sample.fcmToken?.substring(0, 15) + '...',
    });
  } else {
    console.log('ZERO users have an FCM token in the live database!');
  }

  await mongoose.disconnect();
}

run().catch(console.error);
