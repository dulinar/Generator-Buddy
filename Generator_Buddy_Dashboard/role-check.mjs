import "dotenv/config";
import mysql from "mysql2/promise";
const c = await mysql.createConnection({
  host: "141.148.197.200",
  port: 3307,
  user: "project",
  password: process.env.MYSQL_PASSWORD,
  database: "generator_monitoring",
});
const [r] = await c.query(
  "SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='generator_monitoring' AND TABLE_NAME='users' AND COLUMN_NAME='role'",
);
console.log(r);
await c.end();
