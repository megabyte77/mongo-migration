// migrations/dev/dev_teams/teams/20260606171644_change_name.js
// change name
//
// Generated : 2026-06-06 17:16:44 UTC
// ID        : 20260606171644_change_name

module.exports = {
  id: '20260606171644_change_name',
  description: 'change name',
  db: 'dev_teams',
  collection: 'teams',

  async up(db, helpers) {
    // TODO: write your migration here.
    //
    // ── Option A: Plain operation (small collections) ──
    //   await db.collection('teams').updateOne(
    //     { /* filter */ },
    //     { $set: { /* fields */ } }
    //   );
    //

    await db.collection('teams').updateOne(
      {
        _id: new ObjectId("694cf12ab931b16d1444e6d6")
      },
      {
        $set: {
          name: "new-team-name"
        }
      }
    );
  }
};
