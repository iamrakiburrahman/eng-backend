const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env') });

function extractAgeGroup(str) {
  if (!str || typeof str !== 'string') return null;

  // Match U7, U-7, u10, U12, Under 7, Under-11, etc.
  const regex = /(?:^|\s|\b|_|-)(u-?(\d{1,2})|under\s*-?(\d{1,2}))(?:$|\s|\b|_|-)/i;
  const match = str.match(regex);
  if (match) {
    const ageNum = match[2] || match[3];
    if (ageNum) {
      return `U${ageNum}`;
    }
  }
  return null;
}

async function runMigration() {
  const dbUrl = process.env.DATABASE_URL || 'mongodb+srv://engsports:engsports123@cluster0.p7qsl.mongodb.net/engsports?retryWrites=true&w=majority';
  console.log('Connecting to MongoDB...');
  await mongoose.connect(dbUrl);
  console.log('Connected to MongoDB');

  const db = mongoose.connection.db;
  const teamsCollection = db.collection('teams');

  const teams = await teamsCollection.find({}).toArray();
  console.log(`\nFound ${teams.length} total teams in database.`);

  let updatedCount = 0;
  let alreadyHasCount = 0;
  let notFoundCount = 0;

  for (const team of teams) {
    let detectedAgeGroup = null;

    // 1. Check if already has valid ageGroup
    if (team.ageGroup && typeof team.ageGroup === 'string' && team.ageGroup.trim() !== '') {
      console.log(`ℹTeam "${team.teamName}" already has ageGroup: [${team.ageGroup}]`);
      alreadyHasCount++;
      continue;
    }

    // 2. Detect from teamName
    detectedAgeGroup = extractAgeGroup(team.teamName);

    // 3. Detect from shortName
    if (!detectedAgeGroup && team.shortName) {
      detectedAgeGroup = extractAgeGroup(team.shortName);
    }

    if (detectedAgeGroup) {
      await teamsCollection.updateOne(
        { _id: team._id },
        { $set: { ageGroup: detectedAgeGroup } }
      );
      console.log(`Updated Team "${team.teamName}" (ID: ${team._id}) -> ageGroup: "${detectedAgeGroup}"`);
      updatedCount++;
    } else {
      console.log(`No age pattern found in name/shortName for Team "${team.teamName}" (ID: ${team._id}).`);
      notFoundCount++;
    }
  }

  console.log('\n========================================');
  console.log('Migration Completed Successfully!');
  console.log(`Total Teams Checked: ${teams.length}`);
  console.log(`Newly Updated:       ${updatedCount}`);
  console.log(`Already Had Field:   ${alreadyHasCount}`);
  console.log(`No Age in Name:      ${notFoundCount}`);
  console.log('========================================\n');

  process.exit(0);
}

runMigration().catch(err => {
  console.error('Migration Error:', err);
  process.exit(1);
});
