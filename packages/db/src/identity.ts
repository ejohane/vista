import type { MemberRole } from "./schema";

type IdentityMembershipRow = {
  householdId: string;
  householdName: string;
  memberId: string;
  memberRole: MemberRole;
};

export type EnsuredIdentityMembership = {
  created: boolean;
  householdId: string;
  householdName: string;
  memberId: string;
  memberRole: MemberRole;
};

type EnsureClerkIdentityMembershipArgs = {
  clerkUserId: string;
  database: D1Database;
  emailAddress?: null | string;
  firstName?: null | string;
  lastName?: null | string;
  now?: Date;
};

function buildHouseholdName(args: {
  emailAddress?: null | string;
  firstName?: null | string;
  lastName?: null | string;
}) {
  const firstName = args.firstName?.trim();

  if (firstName) {
    return `${firstName} Household`;
  }

  const lastName = args.lastName?.trim();

  if (lastName) {
    return `${lastName} Household`;
  }

  const emailLocalPart = args.emailAddress?.trim().split("@")[0]?.trim();

  if (emailLocalPart) {
    return `${emailLocalPart} Household`;
  }

  return "My Household";
}

async function findClerkIdentityMembership(
  database: D1Database,
  clerkUserId: string,
): Promise<IdentityMembershipRow | null> {
  return database
    .prepare(
      `
        select
          households.id as householdId,
          households.name as householdName,
          members.id as memberId,
          members.role as memberRole
        from user_identities
        inner join members on members.id = user_identities.member_id
        inner join households on households.id = members.household_id
        where user_identities.provider = ?
          and user_identities.provider_user_id = ?
        limit 1
      `,
    )
    .bind("clerk", clerkUserId)
    .first<IdentityMembershipRow>();
}

export async function ensureClerkIdentityMembership(
  args: EnsureClerkIdentityMembershipArgs,
): Promise<EnsuredIdentityMembership> {
  const existingMembership = await findClerkIdentityMembership(
    args.database,
    args.clerkUserId,
  );

  if (existingMembership) {
    return {
      created: false,
      householdId: existingMembership.householdId,
      householdName: existingMembership.householdName,
      memberId: existingMembership.memberId,
      memberRole: existingMembership.memberRole,
    };
  }

  const now = args.now ?? new Date();
  const timestamp = now.getTime();
  const householdId = `household:${crypto.randomUUID()}`;
  const memberId = `member:${crypto.randomUUID()}`;
  const householdName = buildHouseholdName(args);
  const displayName = [args.firstName?.trim(), args.lastName?.trim()]
    .filter(Boolean)
    .join(" ");

  try {
    await args.database.batch([
      args.database
        .prepare(
          `
            insert into households (id, name, last_synced_at, created_at)
            values (?, ?, ?, ?)
          `,
        )
        .bind(householdId, householdName, timestamp, timestamp),
      args.database
        .prepare(
          `
            insert into members (
              id,
              household_id,
              role,
              display_name,
              email,
              created_at,
              updated_at
            )
            values (?, ?, ?, ?, ?, ?, ?)
          `,
        )
        .bind(
          memberId,
          householdId,
          "owner",
          displayName || null,
          args.emailAddress?.trim() || null,
          timestamp,
          timestamp,
        ),
      args.database
        .prepare(
          `
            insert into user_identities (
              id,
              member_id,
              provider,
              provider_user_id,
              email,
              created_at,
              updated_at,
              last_seen_at
            )
            values (?, ?, ?, ?, ?, ?, ?, ?)
          `,
        )
        .bind(
          `identity:clerk:${args.clerkUserId}`,
          memberId,
          "clerk",
          args.clerkUserId,
          args.emailAddress?.trim() || null,
          timestamp,
          timestamp,
          timestamp,
        ),
    ]);
  } catch (error) {
    const concurrentMembership = await findClerkIdentityMembership(
      args.database,
      args.clerkUserId,
    );

    if (concurrentMembership) {
      return {
        created: false,
        householdId: concurrentMembership.householdId,
        householdName: concurrentMembership.householdName,
        memberId: concurrentMembership.memberId,
        memberRole: concurrentMembership.memberRole,
      };
    }

    throw error;
  }

  return {
    created: true,
    householdId,
    householdName,
    memberId,
    memberRole: "owner",
  };
}

export async function getClerkIdentityMembership(
  database: D1Database,
  clerkUserId: string,
) {
  const membership = await findClerkIdentityMembership(database, clerkUserId);

  if (!membership) {
    return null;
  }

  return {
    householdId: membership.householdId,
    householdName: membership.householdName,
    memberId: membership.memberId,
    memberRole: membership.memberRole,
  };
}
