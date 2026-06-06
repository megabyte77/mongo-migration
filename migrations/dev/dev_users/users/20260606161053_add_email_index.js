// migrations/dev/dev_users/users/20260606161053_add_email_index.js
// add email index
//
// Generated : 2026-06-06 16:10:53 UTC
// ID        : 20260606161053_add_email_index

module.exports = {
  id: '20260606161053_add_email_index',
  description: 'add email index',
  db: 'dev_users',
  collection: 'users',

  async up(db, helpers) {
    // TODO: write your migration here.
    //
    // ── Option A: Plain operation (small collections) ──
    //   await db.collection('users').updateOne(
    //     { /* filter */ },
    //     { $set: { /* fields */ } }
    //   );
    //
    // ── Option B: Batched operation (large collections — avoids 'exceeded memory limit') ──
    //   await helpers.batchUpdate(db.collection('users'), {
    //     filter: { /* match docs */ },
    //     update: { $set: { /* fields */ } },
    //     batchSize: 500,
    //     delayMs: 50,
    //   });
    //
    // ── Option C: Import the batch runner directly ──
    //   const { batchUpdate } = require('../../../../runner/dist/batchRunner');
    //   await batchUpdate(db.collection('users'), {
    //     filter: { /* match docs */ },
    //     update: { $set: { /* fields */ } },
    //     batchSize: 500,
    //     delayMs: 50,
    //   });
  }
};
