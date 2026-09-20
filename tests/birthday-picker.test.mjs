import assert from 'node:assert/strict';
import test from 'node:test';
import {birthdayBounds, calendarDays, dateInMonth, isoDate, parseDate} from '../public/assets/js/birthday-picker.mjs';
import {validBirthday} from '../netlify/functions/_shared/onboarding.mjs';

test('birthday parser accepts only real ISO calendar dates',()=>{
  assert.equal(isoDate(parseDate('2004-02-29')), '2004-02-29');
  for(const date of ['', '03/15/2004', '2003-02-29', '2004-13-01', '2004-01-32']) assert.equal(parseDate(date),null);
});
test('month navigation clamps month ends and leap days without skipping a month',()=>{
  assert.equal(isoDate(dateInMonth(2004,1,31)),'2004-02-29');
  assert.equal(isoDate(dateInMonth(2003,1,31)),'2003-02-28');
  assert.equal(isoDate(dateInMonth(2004,-1,31)),'2003-12-31');
  assert.equal(isoDate(dateInMonth(2004,12,31)),'2005-01-31');
});
test('calendar uses six complete Sunday-first weeks with contiguous dates',()=>{
  for(let month=0;month<12;month++) {
    const days=calendarDays(2004,month);
    assert.equal(days.length,42);
    assert.equal(days[0].getUTCDay(),0);
    assert.equal(days[41].getUTCDay(),6);
    assert.equal(days.filter(d=>d.getUTCMonth()===month).length,new Date(Date.UTC(2004,month+1,0)).getUTCDate());
    for(let i=1;i<days.length;i++) assert.equal(days[i]-days[i-1],86400000);
  }
});
test('picker age boundaries exactly match existing server validation including leap-day boundaries',()=>{
  for(const today of ['2026-09-20','2028-02-29','2027-02-28','2028-03-01','2026-01-01']) {
    const now=parseDate(today),{min,max}=birthdayBounds(now);
    assert.equal(validBirthday(isoDate(min),now),true);
    assert.equal(validBirthday(isoDate(max),now),true);
    assert.equal(validBirthday(isoDate(new Date(min.getTime()-86400000)),now),false);
    assert.equal(validBirthday(isoDate(new Date(max.getTime()+86400000)),now),false);
  }
});
