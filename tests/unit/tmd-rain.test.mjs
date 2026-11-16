import test from 'node:test';
import assert from 'node:assert/strict';
import { tmdTime, parseStation } from '../../api/tmd-rain.js';

const XML = `<?xml version="1.0"?><Weather3Hours Version="2.0"><Header><status>200 OK</status></Header><Stations>
<Station><WmoStationNumber>48303</WmoStationNumber><StationNameThai>เชียงราย</StationNameThai><StationNameEnglish>CHIANG RAI</StationNameEnglish><Observation><DateTime>08/02/2021 16:00:00</DateTime><Rainfall Unit="mm">3.30</Rainfall><Rainfall24Hr Unit="mm">3.30</Rainfall24Hr></Observation></Station>
<Station><WmoStationNumber>48327</WmoStationNumber><StationNameThai>&#xE40;&#xE0A;&#xE35;&#xE22;&#xE07;&#xE43;&#xE2B;&#xE21;&#xE48;</StationNameThai><StationNameEnglish>CHIANG MAI</StationNameEnglish><Observation><DateTime>08/02/2021 16:00:00</DateTime><AirTemperature Unit="celcius">31.9</AirTemperature><Rainfall Unit="mm">1.50</Rainfall><Rainfall24Hr Unit="mm">12.60</Rainfall24Hr></Observation></Station>
</Stations></Weather3Hours>`;

test('tmdTime reads TMD local time as +07:00', () => {
  assert.equal(tmdTime('08/02/2021 16:00:00'), '2021-08-02T16:00:00+07:00');
  assert.equal(tmdTime('11/16/2026 13:00'), '2026-11-16T13:00:00+07:00');
  assert.equal(tmdTime('nonsense'), '');
});
test('parseStation picks the Chiang Mai station and its rain', () => {
  const s = parseStation(XML, '48327');
  assert.equal(s.station, 'เชียงใหม่'); assert.equal(s.rain, 1.5); assert.equal(s.rain24, 12.6); assert.equal(s.observedAt, '2021-08-02T16:00:00+07:00');
});
test('parseStation: unknown station or broken xml gives null, missing rain gives 0', () => {
  assert.equal(parseStation(XML, '99999'), null); assert.equal(parseStation('<html>', '48327'), null);
  assert.equal(parseStation('<Station><WmoStationNumber>1</WmoStationNumber><Observation><DateTime>01/02/2026 10:00:00</DateTime></Observation></Station>', '1').rain, 0);
});
