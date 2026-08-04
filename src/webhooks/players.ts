import { pool } from "../db.js";

// Most webhooks (payments, bets, bonuses) carry the smaller "shared user
// object" described in the doc: _id, username, phone, countryCode,
// is_blocked, trusted, withdrawal_block, createdAt. This upsert only ever
// touches those columns, so it never overwrites fields (email, tracker,
// UTM data, etc.) that only the /users registration payload provides.
export async function upsertPlayerCore(user: {
  _id: string;
  username?: string;
  phone?: string;
  countryCode?: string;
  is_blocked?: boolean;
  trusted?: boolean;
  withdrawal_block?: boolean;
  createdAt?: string;
}) {
  await pool.query(
    `INSERT INTO players (id, username, phone, country_code, is_blocked, trusted, withdrawal_block, registered_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (id) DO UPDATE SET
       username         = EXCLUDED.username,
       phone            = EXCLUDED.phone,
       country_code     = EXCLUDED.country_code,
       is_blocked       = EXCLUDED.is_blocked,
       trusted          = EXCLUDED.trusted,
       withdrawal_block = EXCLUDED.withdrawal_block,
       -- registered_at: keep whichever value we saw first. Webhooks are
       -- fire-and-forget with no guaranteed order, so a payment event could
       -- arrive before the /users registration event for the same player.
       registered_at    = COALESCE(players.registered_at, EXCLUDED.registered_at),
       updated_at       = now()`,
    [
      user._id,
      user.username ?? null,
      user.phone ?? null,
      user.countryCode ?? null,
      user.is_blocked ?? null,
      user.trusted ?? null,
      user.withdrawal_block ?? null,
      user.createdAt ?? null,
    ]
  );
}

// Only the /users registration webhook carries these extra fields
// (firstName, email, tracker/affiliate/UTM data). This is the fuller upsert,
// used once per player, when they first register.
export async function upsertPlayerFromRegistration(user: {
  _id: string;
  createdAt?: string;
  is_blocked?: boolean;
  username?: string;
  firstName?: string;
  email?: string;
  phone?: string;
  tracker?: string;
  campaignTag?: string;
  affid?: string;
  provider?: string;
  parentProvider?: string;
  click_id?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  pixel_id?: string;
}) {
  await pool.query(
    `INSERT INTO players (
       id, username, first_name, email, phone, tracker, campaign_tag, affid,
       provider, parent_provider, click_id, utm_source, utm_medium,
       utm_campaign, utm_content, pixel_id, is_blocked, registered_at
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
     ON CONFLICT (id) DO UPDATE SET
       username         = EXCLUDED.username,
       first_name       = EXCLUDED.first_name,
       email            = EXCLUDED.email,
       phone            = EXCLUDED.phone,
       tracker          = EXCLUDED.tracker,
       campaign_tag     = EXCLUDED.campaign_tag,
       affid            = EXCLUDED.affid,
       provider         = EXCLUDED.provider,
       parent_provider  = EXCLUDED.parent_provider,
       click_id         = EXCLUDED.click_id,
       utm_source       = EXCLUDED.utm_source,
       utm_medium       = EXCLUDED.utm_medium,
       utm_campaign     = EXCLUDED.utm_campaign,
       utm_content      = EXCLUDED.utm_content,
       pixel_id         = EXCLUDED.pixel_id,
       is_blocked       = EXCLUDED.is_blocked,
       registered_at    = EXCLUDED.registered_at,
       updated_at       = now()`,
    [
      user._id,
      user.username ?? null,
      user.firstName ?? null,
      user.email ?? null,
      user.phone ?? null,
      user.tracker ?? null,
      user.campaignTag ?? null,
      user.affid ?? null,
      user.provider ?? null,
      user.parentProvider ?? null,
      user.click_id ?? null,
      user.utm_source ?? null,
      user.utm_medium ?? null,
      user.utm_campaign ?? null,
      user.utm_content ?? null,
      user.pixel_id ?? null,
      user.is_blocked ?? null,
      user.createdAt ?? null,
    ]
  );
}
