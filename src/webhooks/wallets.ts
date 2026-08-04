import { pool } from "../db.js";

// A single webhook can carry multiple wallets (a player can hold both an
// INR and a USDT wallet at once), so this upserts every wallet in the array.
// Column names match the platform's own (inconsistent) spelling of
// "wagering" verbatim — see the comment on player_wallets in db-setup.ts.
export async function upsertWallets(
  wallets: Array<{
    _id: string;
    userId: string;
    currency?: string;
    balance?: number;
    wallet_type?: string;
    status?: string;
    is_default?: boolean;
    required_wegaring_amount?: number;
    total_wegaring_amount?: number;
    current_picked_payment_for_wegaring?: string;
    wegering_percent?: number;
    withdrawal_able_amount?: number;
    freebetcash?: number;
    createdAt?: string;
    updatedAt?: string;
  }>
) {
  for (const w of wallets) {
    await pool.query(
      `INSERT INTO player_wallets (
         id, user_id, currency, balance, wallet_type, status, is_default,
         required_wegaring_amount, total_wegaring_amount,
         current_picked_payment_for_wegaring, wegering_percent,
         withdrawal_able_amount, freebetcash, created_at, updated_at
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (id) DO UPDATE SET
         user_id                             = EXCLUDED.user_id,
         currency                            = EXCLUDED.currency,
         balance                             = EXCLUDED.balance,
         wallet_type                         = EXCLUDED.wallet_type,
         status                              = EXCLUDED.status,
         is_default                          = EXCLUDED.is_default,
         required_wegaring_amount            = EXCLUDED.required_wegaring_amount,
         total_wegaring_amount               = EXCLUDED.total_wegaring_amount,
         current_picked_payment_for_wegaring = EXCLUDED.current_picked_payment_for_wegaring,
         wegering_percent                    = EXCLUDED.wegering_percent,
         withdrawal_able_amount              = EXCLUDED.withdrawal_able_amount,
         freebetcash                         = EXCLUDED.freebetcash,
         updated_at                          = EXCLUDED.updated_at`,
      [
        w._id,
        w.userId,
        w.currency ?? null,
        w.balance ?? null,
        w.wallet_type ?? null,
        w.status ?? null,
        w.is_default ?? null,
        w.required_wegaring_amount ?? null,
        w.total_wegaring_amount ?? null,
        w.current_picked_payment_for_wegaring ?? null,
        w.wegering_percent ?? null,
        w.withdrawal_able_amount ?? null,
        w.freebetcash ?? null,
        w.createdAt ?? null,
        w.updatedAt ?? null,
      ]
    );
  }
}
