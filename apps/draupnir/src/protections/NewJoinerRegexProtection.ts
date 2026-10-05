
// Copyright 2024 Gnuxie <Gnuxie@protonmail.com>
//
// SPDX-License-Identifier: Apache-2.0

import {
  AbstractProtection,
  ActionError,
  ActionResult,
  EDStatic,
  Logger,
  MembershipChange,
  MembershipChangeType,
  MultipleErrors,
  Ok,
  OwnLifetime,
  ProtectedRoomsSet,
  Protection,
  ProtectionDescription,
  RoomMembershipRevision,
  UserConsequences,
  describeProtection,
  isError,
} from "matrix-protection-suite";
import { Draupnir } from "../Draupnir";
import { Type } from "@sinclair/typebox";

const log = new Logger("NewJoinerRegexProtection");

const NewJoinerRegexProtectionSettings = Type.Object(
  {
    banList: Type.Array(Type.String(), {
      default: [],
      uniqueItems: true,
      description: `The regex to match user to ban.
        example:
          ban all user with a number at the end '@.*[0-9]:.*'`,
    }),
    allowList: Type.Array(Type.String(), {
      default: [],
      uniqueItems: true,
      description: "The regex to match user to allow, has priority over ban.",
    }),
  },
  { title: "NewJoinerRegexProtectionSettings" }
);

type NewJoinerRegexProtectionSettings = EDStatic<
  typeof NewJoinerRegexProtectionSettings
>;

export type NewJoinerRegexProtectionDescription = ProtectionDescription<
  Draupnir,
  typeof NewJoinerRegexProtectionSettings,
  NewJoinerRegexProtectionCapabilities
>;

export class NewJoinerRegexProtection
  extends AbstractProtection<NewJoinerRegexProtectionDescription>
  implements Protection<NewJoinerRegexProtectionDescription>
{
  private readonly userConsequences: UserConsequences;
  private readonly banReason: string;
  private readonly banList: RegExp[];
  private readonly allowList: RegExp[];
  constructor(
    description: NewJoinerRegexProtectionDescription,
    lifetime: OwnLifetime<Protection<NewJoinerRegexProtectionDescription>>,
    capabilities: NewJoinerRegexProtectionCapabilities,
    protectedRoomsSet: ProtectedRoomsSet,
    settings: NewJoinerRegexProtectionSettings
  ) {
    super(description, lifetime, capabilities, protectedRoomsSet, {});
    this.userConsequences = capabilities.userConsequences;
    this.banReason = "Unfortunately we cannot accept new users from your homeserver at this time.";
    this.banList = settings.banList.flatMap((entry)=> {
      try {
        return new RegExp(entry, 'i');
      } catch (e) {
        log.warn(`[banList] could not parse RegExp value ${entry}`)
        return [];
      }
    });
    this.allowList = settings.allowList.flatMap((entry)=> {
      try {
        return new RegExp(entry, 'i');
      } catch (e) {
        log.warn(`[allowList] could not parse RegExp value ${entry}`)
        return [];
      }
    });
  }

  public async handleMembershipChange(
    revision: RoomMembershipRevision,
    changes: MembershipChange[]
  ): Promise<ActionResult<void>> {
    const errors: ActionError[] = [];
    for (const change of changes) {
      if (change.membershipChangeType === MembershipChangeType.Joined) {
        if(this.allowList.some((regex) => regex.test(change.userID))) {
          continue;
        }
        if(this.banList.some((regex) => regex.test(change.userID))) {
          const banResult =
            await this.userConsequences.consequenceForUserInRoom(
              revision.room.toRoomIDOrAlias(),
              change.userID,
              this.banReason
            );
          if (isError(banResult)) {
            errors.push(banResult.error);
          }
        }
      }
    }
    if (errors.length === 0) {
      return Ok(undefined);
    } else {
      return MultipleErrors.Result(
        `There were errors when banning members in ${revision.room.toPermalink()}`,
        { errors }
      );
    }
  }
}

export type NewJoinerRegexProtectionCapabilities = {
  userConsequences: UserConsequences;
};

describeProtection<
  NewJoinerRegexProtectionCapabilities,
  Draupnir,
  typeof NewJoinerRegexProtectionSettings
>({
  name: "NewJoinerRegexProtection",
  description: `This protection is mean to be used against havy spam / abuse from a lot of accounts.
    It allows to filter users by regex patters to filter them out in a more fine granulate way.
    Configuration can be done life by adding an regex to \`allowList\` or \`banList\`.
    The allowList is always checked first and has priority.
    Will not ban existing users from those servers, and unbanning users will allow them to join normally.
    Please read the documentation https://the-draupnir-project.github.io/draupnir-documentation/protections/new-joiner-protection.`,
  capabilityInterfaces: {
    userConsequences: "UserConsequences",
  },
  defaultCapabilities: {
    userConsequences: "StandardUserConsequences",
  },
  configSchema: NewJoinerRegexProtectionSettings,
  factory: async (
    description,
    lifetime,
    protectedRoomsSet,
    _draupnir,
    capabilitySet,
    rawSettings
  ) => {
    const parsedSettings =
      description.protectionSettings.parseConfig(rawSettings);
    if(isError(parsedSettings)) {
      return parsedSettings;
    }
    return Ok(
      new NewJoinerRegexProtection(
        description,
        lifetime,
        capabilitySet,
        protectedRoomsSet,
        parsedSettings.ok
      )
    )
  },
});

