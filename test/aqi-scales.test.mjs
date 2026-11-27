import test from "node:test";
import assert from "node:assert/strict";
import { indiaNaqiFromPm, subIndex, usAqiFromPm } from "../public/aqi-scales.js";

test("NAQI matches CPCB's published PM2.5 interpolation examples", () => {
  // CPCB: PM2.5 of 31 → 51, 45 → 75 and 60 → 100.
  assert.equal(indiaNaqiFromPm(31, null).aqi, 51);
  assert.equal(indiaNaqiFromPm(45, null).aqi, 75);
  assert.equal(indiaNaqiFromPm(60, null).aqi, 100);
});

test("NAQI category boundaries follow the six CPCB bands", () => {
  for (const [pm25, label] of [
    [0, "Good"],
    [30, "Good"],
    [30.9, "Good"], // truncated to the published integer breakpoint
    [31, "Satisfactory"],
    [61, "Moderately polluted"],
    [91, "Poor"],
    [121, "Very poor"],
    [251, "Severe"],
  ]) {
    assert.equal(indiaNaqiFromPm(pm25, null).label, label, `PM2.5 ${pm25}`);
  }
});

test("NAQI is the highest sub-index and names the dominant pollutant", () => {
  const delhi = indiaNaqiFromPm(156, 218);
  assert.equal(delhi.aqi, 328);
  assert.equal(delhi.label, "Very poor");
  assert.equal(delhi.dominant, "PM2.5");

  const dusty = indiaNaqiFromPm(10, 300);
  assert.equal(dusty.aqi, 250);
  assert.equal(dusty.label, "Poor");
  assert.equal(dusty.dominant, "PM10");
});

test("NAQI is capped at 500 and never invented from missing data", () => {
  assert.equal(indiaNaqiFromPm(900, 900).aqi, 500);
  assert.equal(indiaNaqiFromPm(900, null).label, "Severe");
  assert.equal(indiaNaqiFromPm(null, null), null);
  assert.equal(indiaNaqiFromPm(undefined, Number.NaN), null);
  assert.equal(indiaNaqiFromPm(-5, null), null);
  assert.equal(indiaNaqiFromPm(null, 40).aqi, 40, "PM10 alone is enough for an estimate");
});

test("The same air reads differently on the US and India scales", () => {
  // PM2.5 45 µg/m³ is "Unhealthy for sensitive groups" on US AQI but "Satisfactory" on NAQI.
  assert.equal(usAqiFromPm(45, null), 124);
  assert.equal(indiaNaqiFromPm(45, null).aqi, 75);
});

test("subIndex rejects invalid input and interpolates within a band", () => {
  const table = [
    [0, 10, 0, 50],
    [11, 20, 51, 100],
  ];
  assert.equal(subIndex(null, table), null);
  assert.equal(subIndex("12", table), null);
  assert.equal(subIndex(5, table), 25);
  assert.equal(subIndex(20, table), 100);
  assert.equal(subIndex(1000, table), 500);
});
