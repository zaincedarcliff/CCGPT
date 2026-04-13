import axios from "axios";
import * as cheerio from "cheerio";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const urls = [
  "https://www.wssd.k12.pa.us/cedarcliff.aspx",
  "https://psweb.wssd.k12.pa.us/public/",
  "https://sites.google.com/wssd.bz/the-cedar-cliff-colt-online-ne?usp=sharing",
  "https://sites.google.com/wssd.bz/the-cedar-cliff-colt-online-ne/home/cc-school-news",
  "https://sites.google.com/wssd.bz/the-cedar-cliff-colt-online-ne/home/cc-community-news",
  "https://sites.google.com/wssd.bz/the-cedar-cliff-colt-online-ne/home/cc-sports-news",
  "https://sites.google.com/wssd.bz/the-cedar-cliff-colt-online-ne/home/cc-lifestyle-news",
  "https://sites.google.com/wssd.bz/the-cedar-cliff-colt-online-ne/home/cc-special-news",
  "https://www.wssd.k12.pa.us/AboutCedarCliffHighSchool.aspx",
  "https://www.wssd.k12.pa.us/PrincipalsMessage.aspx",
  "https://www.wssd.k12.pa.us/monthlynewsletter7606.aspx",
  "https://www.wssd.k12.pa.us/SuccessStories.aspx",
  "https://www.wssd.k12.pa.us/DistrictHandbooks.aspx",
  "https://www.wssd.k12.pa.us/Students.aspx",
  "https://www.wssd.k12.pa.us/Parents.aspx",
  "https://www.wssd.k12.pa.us/StudentAttendance.aspx",
  "https://www.wssd.k12.pa.us/AttendanceInformation.aspx",
  "https://www.wssd.k12.pa.us/WorkPermits.aspx",
  "https://www.wssd.k12.pa.us/DailyAnnouncements1.aspx",
  "https://www.wssd.k12.pa.us/Seniors2025.aspx",
  "https://www.wssd.k12.pa.us/CedarCliffGuidance.aspx",
  "https://www.wssd.k12.pa.us/AthleticsCCHS.aspx",
  "https://www.wssd.k12.pa.us/Aquaponics.aspx",
  "https://www.wssd.k12.pa.us/FriendsForever.aspx",
  "https://www.wssd.k12.pa.us/MrsKamps.aspx",
  "https://sites.google.com/wssd.bz/cchs-honors-ap-college",
  "https://www.wssd.k12.pa.us/KeyClub.aspx",
  "https://www.wssd.k12.pa.us/CedarCliffJROTC.aspx",
  "https://www.cedarcliffproductions.com/",
  "https://www.wssd.k12.pa.us/CedarCliffYearbook.aspx",
  "https://www.wssd.k12.pa.us/HighSchoolBellSchedule.aspx",
  "https://www.wssd.k12.pa.us/CedarCliffNHS.aspx",
  "https://www.wssd.k12.pa.us/ActivityFee.aspx",
  "https://www.wssd.k12.pa.us/AthleticForms.aspx",
  "https://www.wssd.k12.pa.us/DirectionstoAreaSchools.aspx",
  "https://www.wssd.k12.pa.us/InterscholasticAthleticDisclosureForms.aspx",
  "https://www.wssd.k12.pa.us/WestShoreNatatorium.aspx",
  "https://www.wssd.k12.pa.us/WestShoreStadiumBagPolicy.aspx",
  "https://www.wssd.k12.pa.us/Athletics.aspx",
  "https://www.arbiterlive.com/Teams?entityId=3551",
  "https://www.wssd.k12.pa.us/Monthlye-News.aspx",
  "https://www.wssd.k12.pa.us/FoodServices.aspx",
  "https://www.wssd.k12.pa.us/Menus.aspx",
  "https://www.wssd.k12.pa.us/FreeandReducedMeals.aspx",
  "https://www.wssd.k12.pa.us/StudentMealAccounts.aspx",
  "https://www.wssd.k12.pa.us/WellnessPolicyNutritionalStandards.aspx",
];

async function updateAllData() {
  let allData = [];

  for (const url of urls) {
    try {
      const { data } = await axios.get(url, { timeout: 15000 });
      const $ = cheerio.load(data);

      let pageText = [];

      $("h1, h2, h3, p, li, td, th").each((_i, el) => {
        const text = $(el).text().trim();
        if (text.length > 40) {
          pageText.push(text);
        }
      });

      allData.push({
        source: url,
        scrapedAt: new Date().toISOString(),
        content: pageText,
      });

      console.log(`Scraped: ${url}`);
    } catch (err) {
      console.log(`Failed: ${url} — ${err.message}`);
    }
  }

  const outPath = path.join(__dirname, "public", "schoolData.json");
  fs.writeFileSync(outPath, JSON.stringify(allData, null, 2));
  console.log(`\u2705 Data updated! Wrote ${outPath}`);
}

updateAllData();