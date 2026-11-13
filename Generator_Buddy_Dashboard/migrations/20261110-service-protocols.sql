CREATE TABLE IF NOT EXISTS service_protocols (
  protocol_id VARCHAR(40) PRIMARY KEY,
  title VARCHAR(160) NOT NULL,
  interval_hours INT UNSIGNED NOT NULL,
  instructions TEXT NOT NULL,
  recurring BOOLEAN NOT NULL DEFAULT TRUE
);
INSERT IGNORE INTO service_protocols VALUES
('break-in','Initial break-in inspection',50,'Sample: inspect oil, filters, belt tension and terminals. Confirm against your manufacturer manual.',FALSE),
('oil-service','Engine oil and filter replacement',250,'Sample: replace engine oil and oil filter. Confirm oil grade and interval against your manufacturer manual.',TRUE),
('fuel-air','Fuel and air filter inspection',500,'Sample: inspect fuel filters, water separator and air cleaner. Confirm replacement requirements against your manual.',TRUE),
('coolant','Cooling system inspection',1000,'Sample: inspect coolant condition and cooling system. Confirm coolant replacement interval against your manual.',TRUE);
CREATE TABLE IF NOT EXISTS telemetry_alert_cursor (
  generator_id INT PRIMARY KEY,
  reading_id BIGINT NOT NULL,
  config_digest CHAR(64) NOT NULL
);
