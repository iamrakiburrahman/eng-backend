const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

// Load environment variables from .env if present
dotenv.config({ path: path.join(__dirname, '../.env') });

/**
 * Extract age group from league name.
 * e.g. "WLPL Sunday u10" -> "u10"
 *      "Premiership Saturday u7" -> "u7"
 *      "Championship Saturday Under 12" -> "u12"
 */
function extractAgeGroup(leagueName, knownCategories = []) {
  if (!leagueName || typeof leagueName !== 'string') return null;

  const trimmedName = leagueName.trim();

  // 1. Try to match known categories from AgeGroupCategory (case-insensitive)
  for (const cat of knownCategories) {
    if (!cat || typeof cat !== 'string') continue;
    const catClean = cat.trim();
    const regex = new RegExp(`(?:^|\\s|_|-)\\b${catClean}\\b(?:$|\\s|_|-)`, 'i');
    if (regex.test(trimmedName)) {
      return catClean;
    }
  }

  // 2. Flexible regex to extract u7, u8, u-10, u12, under 14, etc.
  const ageRegex = /(?:^|\s|_|-)(u-?(\d{1,2})|under\s*-?(\d{1,2}))(?:$|\s|_|-)/i;
  const match = trimmedName.match(ageRegex);
  if (match) {
    const ageNum = match[2] || match[3];
    if (ageNum) {
      // If a known category exists for this number (e.g. "u10" or "U10"), preserve that format
      const matchedKnown = knownCategories.find(c => {
        const num = c.match(/\d+/)?.[0];
        return num === ageNum;
      });
      if (matchedKnown) return matchedKnown;

      return `u${ageNum}`;
    }
  }

  return null;
}

async function runMigration() {
  // Support passing custom DB URI via argument or environment variable:
  // node scripts/migrateLeagueAgeGroups.js "mongodb+srv://..."
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run');
  const isForce = args.includes('--force');
  const customUriArg = args.find(a => !a.startsWith('--'));

  const dbUrl =
    customUriArg ||
    process.env.DATABASE_URL ||
    process.env.MONGODB_URI ||
    process.env.DB_URL;

  if (!dbUrl) {
    console.error('Error: No MongoDB connection URI found in arguments or .env file.');
    console.error('Usage: node scripts/migrateLeagueAgeGroups.js [MONGO_URI] [--dry-run] [--force]');
    process.exit(1);
  }

  const maskedUri = dbUrl.replace(/\/\/([^:]+):([^@]+)@/, '//$1:****@');
  console.log(`\nConnecting to MongoDB: ${maskedUri}`);
  if (isDryRun) {
    console.log('Running in DRY RUN mode (no changes will be written to database)');
  }
  if (isForce) {
    console.log('Running in FORCE mode (will re-extract and overwrite existing ageGroup)');
  }

  await mongoose.connect(dbUrl);
  console.log('Connected successfully to MongoDB.\n');

  const db = mongoose.connection.db;
  const leaguesCollection = db.collection('leagues');
  const categoriesCollection = db.collection('agegroupcategories');

  // Fetch known subcategories from AgeGroupCategory for 100% exact naming
  const rawCategories = await categoriesCollection.find({}).toArray();
  const knownAges = [];
  rawCategories.forEach(c => {
    if (c.parentCategory && c.name) knownAges.push(c.name.trim());
    if (Array.isArray(c.subCategories)) {
      c.subCategories.forEach(s => {
        if (s && s.name) knownAges.push(s.name.trim());
      });
    }
    // Also include parent categories if they look like an age group (e.g. u10, under 12)
    if (!c.parentCategory && c.name && /^(u|under\s*)\d+/i.test(c.name)) {
      knownAges.push(c.name.trim());
    }
  });

  const uniqueKnownAges = Array.from(new Set(knownAges));
  console.log(`Loaded ${uniqueKnownAges.length} reference age groups from AgeGroupCategory:`, uniqueKnownAges);

  const leagues = await leaguesCollection.find({}).toArray();
  console.log(`\nTotal leagues found in database: ${leagues.length}\n`);

  let updatedCount = 0;
  let alreadyHasCount = 0;
  let notFoundCount = 0;

  for (let i = 0; i < leagues.length; i++) {
    const league = leagues[i];
    const indexStr = `${i + 1}`.padStart(2, '0');

    // If league already has ageGroup and not force mode, skip
    if (!isForce && league.ageGroup && typeof league.ageGroup === 'string' && league.ageGroup.trim() !== '') {
      console.log(`ℹ[${indexStr}/${leagues.length}] "${league.leagueName}" -> Already has ageGroup: [${league.ageGroup}]`);
      alreadyHasCount++;
      continue;
    }

    const detected = extractAgeGroup(league.leagueName, uniqueKnownAges);

    if (detected) {
      if (!isDryRun) {
        await leaguesCollection.updateOne(
          { _id: league._id },
          { $set: { ageGroup: detected } }
        );
      }
      console.log(`[${indexStr}/${leagues.length}] "${league.leagueName}" -> ${isDryRun ? '[DRY-RUN] Would set' : 'Updated to'} ageGroup: "${detected}"`);
      updatedCount++;
    } else {
      console.log(`[${indexStr}/${leagues.length}] "${league.leagueName}" -> No age pattern found in name.`);
      notFoundCount++;
    }
  }

  console.log('\n========================================');
  console.log(`League Migration Summary ${isDryRun ? '(DRY RUN)' : '(LIVE)'}`);
  console.log('========================================');
  console.log(`Total Leagues Checked : ${leagues.length}`);
  console.log(`Successfully Updated  : ${updatedCount}`);
  console.log(`Already Had ageGroup  : ${alreadyHasCount}`);
  console.log(`No Age in Name        : ${notFoundCount}`);
  console.log('========================================\n');

  await mongoose.disconnect();
  console.log('Disconnected from MongoDB.');
  process.exit(0);
}

runMigration().catch(err => {
  console.error('\nMigration Failed with Error:', err);
  process.exit(1);
});
