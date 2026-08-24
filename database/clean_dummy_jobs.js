const { getPool } = require('../backend/shared/dist');

async function cleanAllDummyJobs() {
  const pool = getPool();
  try {
    console.log('Cleaning all dummy/test jobs and execution records from database...');
    await pool.query('DELETE FROM dead_letter_jobs');
    await pool.query('DELETE FROM job_logs');
    await pool.query('DELETE FROM job_executions');
    await pool.query('DELETE FROM jobs');
    await pool.query('DELETE FROM batch_groups');
    await pool.query('DELETE FROM scheduled_jobs');

    // Remove ephemeral test queues while keeping standard clean queues
    await pool.query(`DELETE FROM queues WHERE name NOT IN ('email-queue', 'report-generation', 'webhook-delivery') AND name ~ '[0-9]{10,}'`);
    // Remove all stale test workers
    await pool.query(`DELETE FROM workers WHERE last_heartbeat_at < NOW() - INTERVAL '1 minute' OR hostname LIKE '%test%' OR hostname LIKE '%LAPTOP%'`);

    const jobCount = await pool.query('SELECT count(*) FROM jobs');
    const dlqCount = await pool.query('SELECT count(*) FROM dead_letter_jobs');
    const schedCount = await pool.query('SELECT count(*) FROM scheduled_jobs');
    const queueCount = await pool.query('SELECT count(*) FROM queues');

    console.log('\n--- Database Cleanup Summary ---');
    console.log(`- Total jobs in DB: ${jobCount.rows[0].count}`);
    console.log(`- Total DLQ records in DB: ${dlqCount.rows[0].count}`);
    console.log(`- Total scheduled_jobs in DB: ${schedCount.rows[0].count}`);
    console.log(`- Total clean queues in DB: ${queueCount.rows[0].count}`);
    console.log('--------------------------------\n');
  } catch (err) {
    console.error('Error during cleanup:', err);
  } finally {
    await pool.end();
  }
}

cleanAllDummyJobs();
