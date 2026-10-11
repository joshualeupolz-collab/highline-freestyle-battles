import { env } from 'cloudflare:workers';
import { DEFAULT_RULESET_PARAMS } from '@hfb/rating';
import { describe, expect, it } from 'vitest';
import { call, registerAdmin, registerAthlete } from './helpers';

const newFormat = {
  slug: 'trick-combo-5',
  name: '5-Trick Combo',
  parts: [{ kind: 'trick_combo', count: 5 }],
};

async function auditActions() {
  const { results } = await env.DB.prepare('SELECT action FROM audit_log ORDER BY created_at').all<{
    action: string;
  }>();
  return results.map((r) => r.action);
}

describe('managing formats', () => {
  it('lets an admin create a format with version 1', async () => {
    const admin = await registerAdmin();
    const res = await call('/api/formats', { session: admin.session, body: newFormat });
    expect(res.status).toBe(201);
    const { format } = (await res.json()) as {
      format: { id: string; version: number; status: string };
    };
    expect(format).toMatchObject({ version: 1, status: 'relevant' });

    const list = (await (await call('/api/formats')).json()) as { formats: { slug: string }[] };
    expect(list.formats.map((f) => f.slug)).toContain('trick-combo-5');
    expect(await auditActions()).toContain('format.create');
  });

  it('rejects athletes, duplicate slugs and invalid parts', async () => {
    const admin = await registerAdmin();
    const anna = await registerAthlete('anna', admin.session);
    expect((await call('/api/formats', { session: anna.session, body: newFormat })).status).toBe(
      403,
    );
    await call('/api/formats', { session: admin.session, body: newFormat });
    expect((await call('/api/formats', { session: admin.session, body: newFormat })).status).toBe(
      409,
    );
    const invalid = { ...newFormat, slug: 'x-y', parts: [{ kind: 'juggling', count: 1 }] };
    expect((await call('/api/formats', { session: admin.session, body: invalid })).status).toBe(
      400,
    );
  });

  it('versions the parts and keeps the history', async () => {
    const admin = await registerAdmin();
    const { format } = (await (
      await call('/api/formats', { session: admin.session, body: newFormat })
    ).json()) as {
      format: { id: string };
    };
    const res = await call(`/api/formats/${format.id}/versions`, {
      session: admin.session,
      body: { parts: [{ kind: 'trick_combo', count: 6 }], reason: 'test' },
    });
    expect(res.status).toBe(201);
    const detail = (await (await call(`/api/formats/${format.id}`)).json()) as {
      format: { version: number };
      versions: { version: number }[];
    };
    expect(detail.format.version).toBe(2);
    expect(detail.versions.map((v) => v.version)).toEqual([1, 2]);
  });

  it('requests a rating replay when kPoints changes', async () => {
    const admin = await registerAdmin();
    const { format } = (await (
      await call('/api/formats', { session: admin.session, body: newFormat })
    ).json()) as {
      format: { id: string };
    };
    const patch = (body: unknown) =>
      call(`/api/formats/${format.id}`, { method: 'PATCH', session: admin.session, body });
    expect((await patch({ status: 'fun' })).status).toBe(200);
    expect((await patch({ kPoints: 1.5, reason: 'poll result' })).status).toBe(200);
    expect((await patch({ reason: 'only a reason' })).status).toBe(400);
    const replays = await env.DB.prepare('SELECT COUNT(*) AS n FROM replay_requests').first<{
      n: number;
    }>();
    expect(replays?.n).toBe(1);
  });

  it('archives a format so it disappears from the list', async () => {
    const admin = await registerAdmin();
    const { format } = (await (
      await call('/api/formats', { session: admin.session, body: newFormat })
    ).json()) as {
      format: { id: string };
    };
    expect(
      (await call(`/api/formats/${format.id}/archive`, { method: 'POST', session: admin.session }))
        .status,
    ).toBe(200);
    const list = (await (await call('/api/formats')).json()) as { formats: { id: string }[] };
    expect(list.formats.map((f) => f.id)).not.toContain(format.id);
    expect((await call(`/api/formats/${format.id}`)).status).toBe(200);
  });
});

describe('managing RuleSets', () => {
  it('creates a new version with validated parameters', async () => {
    const admin = await registerAdmin();
    const params = { ...DEFAULT_RULESET_PARAMS, clamp: 'both' };
    const res = await call('/api/rulesets', {
      session: admin.session,
      body: { params, note: 'Poll: loser never gains' },
    });
    expect(res.status).toBe(201);
    const current = (await (await call('/api/rulesets/current')).json()) as {
      version: number;
      params: { clamp: string };
    };
    expect(current).toMatchObject({ version: 2, params: { clamp: 'both' } });
    expect(await auditActions()).toContain('ruleset.create');
  });

  it('rejects invalid parameters and non-admins', async () => {
    const admin = await registerAdmin();
    const anna = await registerAthlete('anna', admin.session);
    const body = { params: DEFAULT_RULESET_PARAMS, note: 'x' };
    expect((await call('/api/rulesets', { session: anna.session, body })).status).toBe(403);
    const invalid = { params: { ...DEFAULT_RULESET_PARAMS, tau: -1 }, note: 'x' };
    expect((await call('/api/rulesets', { session: admin.session, body: invalid })).status).toBe(
      400,
    );
  });
});

describe('format proposals', () => {
  const proposal = { name: '2-Trick Combo', parts: [{ kind: 'trick_combo', count: 2 }] };

  it('lets any athlete propose; the format is unusable until an admin approves it', async () => {
    const admin = await registerAdmin();
    const anna = await registerAthlete('anna', admin.session);
    const res = await call('/api/formats/proposals', { session: anna.session, body: proposal });
    expect(res.status).toBe(201);
    const { proposal: created } = (await res.json()) as {
      proposal: { id: string; slug: string; state: string };
    };
    expect(created).toMatchObject({ slug: '2-trick-combo', state: 'pending' });

    const list = (await (await call('/api/formats')).json()) as { formats: { id: string }[] };
    expect(list.formats.map((f) => f.id)).not.toContain(created.id);
    const battle = await call('/api/battles', {
      session: anna.session,
      body: { formatId: created.id },
    });
    expect(battle.status).toBe(400);

    const pending = (await (
      await call('/api/formats/proposals', { session: admin.session })
    ).json()) as {
      proposals: { id: string; proposedBy: { username: string } }[];
    };
    expect(pending.proposals.map((p) => [p.id, p.proposedBy.username])).toEqual([
      [created.id, 'anna'],
    ]);

    expect(
      (
        await call(`/api/formats/${created.id}/approve`, {
          session: anna.session,
          body: { status: 'fun' },
        })
      ).status,
    ).toBe(403);
    const approved = await call(`/api/formats/${created.id}/approve`, {
      session: admin.session,
      body: { status: 'fun' },
    });
    expect(approved.status).toBe(200);
    const after = (await (await call('/api/formats')).json()) as {
      formats: { id: string; status: string }[];
    };
    expect(after.formats.find((f) => f.id === created.id)?.status).toBe('fun');
    expect(
      (await call('/api/battles', { session: anna.session, body: { formatId: created.id } }))
        .status,
    ).toBe(201);
    expect(await auditActions()).toContain('format.approve');
  });

  it('shows the proposer a rejection with its note', async () => {
    const admin = await registerAdmin();
    const anna = await registerAthlete('anna', admin.session);
    const { proposal: created } = (await (
      await call('/api/formats/proposals', { session: anna.session, body: proposal })
    ).json()) as { proposal: { id: string } };
    const res = await call(`/api/formats/${created.id}/reject`, {
      session: admin.session,
      body: { note: 'Same as 3-Trick Combo' },
    });
    expect(res.status).toBe(200);
    const mine = (await (
      await call('/api/formats/proposals', { session: anna.session })
    ).json()) as {
      proposals: { state: string; reviewNote: string }[];
    };
    expect(mine.proposals).toMatchObject([
      { state: 'rejected', reviewNote: 'Same as 3-Trick Combo' },
    ]);
  });

  it('limits open proposals per person and generates unique slugs', async () => {
    const admin = await registerAdmin();
    const anna = await registerAthlete('anna', admin.session);
    const slugs: string[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await call('/api/formats/proposals', { session: anna.session, body: proposal });
      slugs.push(((await res.json()) as { proposal: { slug: string } }).proposal.slug);
    }
    expect(slugs).toEqual([
      '2-trick-combo',
      '2-trick-combo-2',
      '2-trick-combo-3',
      '2-trick-combo-4',
      '2-trick-combo-5',
    ]);
    expect(
      (await call('/api/formats/proposals', { session: anna.session, body: proposal })).status,
    ).toBe(429);
  });
});
