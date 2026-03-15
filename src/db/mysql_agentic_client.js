const { getAgenticMySqlConfig } = require("./mysql_agentic_config");

let mysqlModule = null;
let loadError = null;
let pool = null;

function tryLoadMysql() {
  if (mysqlModule || loadError) {
    return mysqlModule;
  }
  try {
    mysqlModule = require("mysql2/promise");
  } catch (error) {
    loadError = error;
  }
  return mysqlModule;
}

function getClientStatus() {
  const config = getAgenticMySqlConfig();
  const mysql = tryLoadMysql();

  if (!config.enabled) {
    return { enabled: false, reason: "disabled_by_config" };
  }
  if (!mysql) {
    return { enabled: false, reason: `mysql2_missing: ${loadError?.message || "unknown"}` };
  }
  return { enabled: true, reason: "ready" };
}

function getPool() {
  const config = getAgenticMySqlConfig();
  const status = getClientStatus();
  if (!status.enabled) {
    return null;
  }
  if (pool) {
    return pool;
  }

  if (config.uri) {
    pool = mysqlModule.createPool({
      uri: config.uri,
      connectionLimit: config.connectionLimit,
      namedPlaceholders: true
    });
    return pool;
  }

  pool = mysqlModule.createPool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    connectionLimit: config.connectionLimit,
    namedPlaceholders: true
  });
  return pool;
}

async function withTransaction(fn) {
  const activePool = getPool();
  if (!activePool) {
    return null;
  }
  const conn = await activePool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

async function closePool() {
  if (!pool) {
    return;
  }
  const activePool = pool;
  pool = null;
  await activePool.end();
}

module.exports = {
  closePool,
  getClientStatus,
  getPool,
  withTransaction
};
