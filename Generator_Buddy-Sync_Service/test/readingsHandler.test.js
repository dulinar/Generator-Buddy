const assert = require('assert');
const {
  extractGeneratorId,
  formatRtcTimestamp,
  validatePayload,
  handleIncomingReading,
  checkOfflineGenerators,
  REQUIRED_NUMERIC_FIELDS,
  VALID_STATUSES
} = require('../src/readingsHandler');

console.log('--- Running Generator Monitoring Sync Service Unit Tests ---');

// Test 1: extractGeneratorId (validates positive integer IDs matching INT schema)
{
  console.log('Test 1: Topic generator_id extraction (Integer matching schema)');
  assert.strictEqual(extractGeneratorId('generator/1/readings'), 1);
  assert.strictEqual(extractGeneratorId('generator/42/readings'), 42);
  assert.strictEqual(extractGeneratorId('generator/1050/readings'), 1050);
  assert.strictEqual(extractGeneratorId('generator/GEN-01/readings'), null);
  assert.strictEqual(extractGeneratorId('generator/0/readings'), null);
  assert.strictEqual(extractGeneratorId('generator/-5/readings'), null);
  assert.strictEqual(extractGeneratorId('generator//readings'), null);
  assert.strictEqual(extractGeneratorId('generator/1/2/readings'), null);
  assert.strictEqual(extractGeneratorId('other/topic'), null);
  assert.strictEqual(extractGeneratorId(null), null);
  console.log('  ✔ Topic integer extraction passed');
}

// Test 2: formatRtcTimestamp
{
  console.log('Test 2: RTC timestamp preservation');
  const rtcTimestamp = '2026-09-06T14:32:10';
  const formatted = formatRtcTimestamp(rtcTimestamp);
  assert.strictEqual(formatted, '2026-09-06 14:32:10');
  assert.strictEqual(formatRtcTimestamp('2026-09-06T14:32:10Z'), '2026-09-06 14:32:10');
  assert.strictEqual(formatRtcTimestamp('2026-09-06T14:32:10.000Z'), '2026-09-06 14:32:10');
  console.log('  ✔ RTC timestamp format preserved');
}

// Test 3: validatePayload with both new and legacy field names
{
  console.log('Test 3: Valid payload validation');
  const newFormatSample = {
    recorded_at: '2026-09-06T14:32:10',
    status: 'running',
    voltage: 230.0,
    current: 15.0,
    frequency: 50.0,
    temperature: 75.0,
    fuel_level: 80.0,
    runtime_seconds: 120000
  };

  const res1 = validatePayload(newFormatSample);
  assert.strictEqual(res1.valid, true);
  assert.strictEqual(res1.cleanData.voltage, 230.0);
  assert.strictEqual(res1.cleanData.current, 15.0);
  assert.strictEqual(res1.cleanData.temperature, 75.0);
  assert.strictEqual(res1.cleanData.status, 'running');

  // Sample with legacy field names (ac_voltage, ac_current, engine_temp)
  const legacySample = {
    recorded_at: '2026-09-06T14:32:10',
    status: 'stopped',
    ac_voltage: 231.5,
    ac_current: 12.3,
    frequency: 50.1,
    fuel_level: 68.0,
    engine_temp: 78.4,
    runtime_seconds: 154200
  };

  const res2 = validatePayload(legacySample);
  assert.strictEqual(res2.valid, true);
  assert.strictEqual(res2.cleanData.voltage, 231.5);
  assert.strictEqual(res2.cleanData.current, 12.3);
  assert.strictEqual(res2.cleanData.temperature, 78.4);
  assert.strictEqual(res2.cleanData.status, 'stopped');
  assert.strictEqual(res2.cleanData.recorded_at, '2026-09-06 14:32:10');
  console.log('  ✔ Valid payload passed (both new and legacy field names supported)');
}

// Test 4: Status validation
{
  console.log('Test 4: Status normalization for generator_readings enum');
  for (const st of ['running', 'stopped', 'fault', 'maintenance']) {
    const sample = {
      recorded_at: '2026-09-06T14:32:10',
      status: st,
      voltage: 230,
      current: 10,
      frequency: 50,
      temperature: 70,
      fuel_level: 50,
      runtime_seconds: 1000
    };
    const res = validatePayload(sample);
    assert.strictEqual(res.valid, true);
    assert.strictEqual(res.cleanData.status, st);
  }
  console.log('  ✔ Status enum validation passed');
}

// Test 5: Missing numeric fields rejection
{
  console.log('Test 5: Missing numeric fields rejection');
  for (const field of REQUIRED_NUMERIC_FIELDS) {
    const incompleteSample = {
      recorded_at: '2026-09-06T14:32:10',
      status: 'running',
      voltage: 230,
      current: 10,
      frequency: 50,
      temperature: 70,
      fuel_level: 50,
      runtime_seconds: 1000
    };
    delete incompleteSample[field];
    const res = validatePayload(incompleteSample);
    assert.strictEqual(res.valid, false, `Field "${field}" should be required`);
  }
  console.log('  ✔ Missing numeric fields correctly rejected');
}

// Test 6: Invalid types & NaN rejection
{
  console.log('Test 6: Invalid types & NaN rejection');
  const nanSample = {
    recorded_at: '2026-09-06T14:32:10',
    status: 'running',
    voltage: NaN,
    current: 10,
    frequency: 50,
    temperature: 70,
    fuel_level: 50,
    runtime_seconds: 1000
  };
  assert.strictEqual(validatePayload(nanSample).valid, false);

  const stringSample = { ...nanSample, voltage: '230V' };
  assert.strictEqual(validatePayload(stringSample).valid, false);

  const badDateSample = { ...nanSample, voltage: 230, recorded_at: 'invalid-date' };
  assert.strictEqual(validatePayload(badDateSample).valid, false);

  assert.strictEqual(validatePayload(null).valid, false);
  assert.strictEqual(validatePayload([]).valid, false);
  console.log('  ✔ Invalid types & formats correctly rejected');
}

// Test 7: End-to-end handleIncomingReading updating generator_readings and generators table
(async () => {
  console.log('Test 7: End-to-end handleIncomingReading with mock DB');
  const recordedQueries = [];
  const mockPool = {
    async query(sql, params) {
      recordedQueries.push({ sql: sql.trim(), params });
      return [{ insertId: 101, affectedRows: 1 }];
    }
  };

  const samplePayload = JSON.stringify({
    recorded_at: '2026-09-06T14:32:10',
    status: 'running',
    voltage: 231.5,
    current: 12.3,
    frequency: 50.1,
    temperature: 78.4,
    fuel_level: 68.0,
    runtime_seconds: 154200
  });

  await handleIncomingReading(mockPool, 'generator/1/readings', samplePayload);

  assert.strictEqual(recordedQueries.length, 2, 'Should execute 2 queries: insert generator_readings and update generators');
  
  // Verify generator_readings insert query
  const insertQuery = recordedQueries[0];
  assert.ok(insertQuery.sql.startsWith('INSERT INTO generator_readings'));
  assert.strictEqual(insertQuery.params[0], 1); // Generator ID
  assert.strictEqual(insertQuery.params[1], 'running'); // status
  assert.strictEqual(insertQuery.params[2], 231.5); // voltage
  assert.strictEqual(insertQuery.params[3], 12.3); // current
  assert.strictEqual(insertQuery.params[4], 50.1); // frequency
  assert.strictEqual(insertQuery.params[5], 78.4); // temperature
  assert.strictEqual(insertQuery.params[6], 68.0); // fuel_level
  assert.strictEqual(insertQuery.params[7], 154200); // runtime_seconds
  assert.strictEqual(insertQuery.params[8], '2026-09-06 14:32:10'); // recorded_at

  // Verify generators update query (updates status and last_seen)
  const updateQuery = recordedQueries[1];
  assert.ok(updateQuery.sql.startsWith('UPDATE generators SET status = ?, last_seen = CURRENT_TIMESTAMP'));
  assert.strictEqual(updateQuery.params[0], 'running');
  assert.strictEqual(updateQuery.params[1], 1);

  console.log('  ✔ Mock DB write to generator_readings and generators table verified');

  // Test 8: DB error resilience (catches foreign key or lock errors)
  console.log('Test 8: DB error resilience (catches foreign key or lock errors)');
  const failingPool = {
    async query() {
      const err = new Error('Cannot add or update a child row: a foreign key constraint fails');
      err.code = 'ER_NO_REFERENCED_ROW_2';
      err.errno = 1452;
      throw err;
    }
  };

  await handleIncomingReading(failingPool, 'generator/999/readings', samplePayload);
  console.log('  ✔ DB failure caught gracefully without crashing');

  // Test 9: checkOfflineGenerators
  console.log('Test 9: checkOfflineGenerators functionality');
  const offlineQueries = [];
  const offlineMockPool = {
    async query(sql, params) {
      offlineQueries.push({ sql: sql.trim(), params });
      return [{ affectedRows: 2 }];
    }
  };

  await checkOfflineGenerators(offlineMockPool, 60);
  assert.strictEqual(offlineQueries.length, 1);
  assert.ok(offlineQueries[0].sql.includes("UPDATE generators SET status = 'offline'"));
  assert.strictEqual(offlineQueries[0].params[0], 60);
  console.log('  ✔ Inactive generator offline monitor query verified');

  console.log('\nAll 9 Unit Tests Passed Successfully! 🚀');
})().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
