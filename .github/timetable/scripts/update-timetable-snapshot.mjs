import { writeFile } from 'node:fs/promises';
import classes from '../lib/timetable-classes.json' with { type:'json' };
import { loadClasses, readNeisSheet } from '../lib/timetable.ts';

const today = new Date(Date.now() + 9 * 3600000);
const date = (days = 0) => new Date(today.getTime() + days * 86400000).toISOString().slice(0,10);
const schoolYear = String(today.getUTCFullYear() - Number(today.getUTCMonth() < 2));
const [start = [schoolYear+'-03-01',date(-35)].sort().at(-1),end = date(45),year = schoolYear] = process.argv.slice(2);
if (![start,end].every(day => /^20\d{2}-\d{2}-\d{2}$/.test(day)) || !/^20\d{2}$/.test(year) || start > end) {
  throw Error('Usage: node scripts/update-timetable-snapshot.mjs START_DATE END_DATE SCHOOL_YEAR');
}
const liveClasses = await loadClasses(year,AbortSignal.timeout(6500)).catch(() => []);
const rooms = liveClasses.length ? liveClasses : classes[year] ?? [];
if (!rooms.length) throw Error('No verified class list is available');
const schedule = {};
for (const room of rooms) {
  const lessons = await readNeisSheet(start,end,year,room,'2500');
  for (const lesson of lessons) {
    const monday = new Date(lesson.date + 'T00:00:00Z');
    const weekday = monday.getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    monday.setUTCDate(monday.getUTCDate() - (weekday + 6) % 7);
    const key = [monday.toISOString().slice(0,10),room.grade,room.room].join(':');
    (schedule[key] ??= []).push(lesson);
  }
  console.log(`${room.grade}-${room.room}: ${lessons.length} lessons`);
}
if (!Object.keys(schedule).length) throw Error('No verified timetable was returned');
const checkedOn = date();
await writeFile(new URL('../lib/timetable-snapshot.json',import.meta.url),JSON.stringify({checkedOn,lessons:schedule})+'\n');
