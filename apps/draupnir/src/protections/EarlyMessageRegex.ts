// Copyright 2026 Tuxcoder <git@o-g.at>
// Copyright 2022 Gnuxie <Gnuxie@protonmail.com>
// Copyright 2019, 2020 The Matrix.org Foundation C.I.C.
//
// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileAttributionText: <text>
// This modified file incorporates work from mjolnir
// https://github.com/matrix-org/mjolnir
// </text>

import { LogLevel, LogService } from "@vector-im/matrix-bot-sdk";
import {
  AbstractProtection,
  ActionResult,
  EDStatic,
  EventConsequences,
  Logger,
  MembershipChange,
  MembershipChangeType,
  Ok,
  OwnLifetime,
  ProtectedRoomsSet,
  Protection,
  ProtectionDescription,
  RoomEvent,
  RoomMembershipRevision,
  RoomMessage,
  UserConsequences,
  Value,
  describeProtection,
} from "matrix-protection-suite";
import { Draupnir } from "../Draupnir";
import {
  MatrixRoomID,
  StringRoomID,
  StringUserID,
} from "@the-draupnir-project/matrix-basic-types";
import { Type } from "@sinclair/typebox";

const log = new Logger("EarlyMessageRegex");

export type EarlyMessageRegexProtectionCapabilities = {
  userConsequences: UserConsequences;
  eventConsequences: EventConsequences;
};

const EarlyMessageRegexProtectionSettings = Type.Object(
  {
    disallowMedia: Type.Boolean({
      description: "disallow images in the beginning",
      default: true,
    }),
    disallowList: Type.Array(Type.String(), {
      default: [],
      uniqueItems: true,
      description: "The regex to match messages",
    }),
  },
  { title: "EarlyMessageRegexProtectionSettings" }
);

type EarlyMessageRegexProtectionSettings = EDStatic<
  typeof EarlyMessageRegexProtectionSettings
>;

export type EarlyMessageRegexProtectionDescription = ProtectionDescription<
  Draupnir,
  typeof EarlyMessageRegexProtectionSettings,
  EarlyMessageRegexProtectionCapabilities
>;

export class EarlyMessageRegexProtection
  extends AbstractProtection<EarlyMessageRegexProtectionDescription>
  implements Protection<EarlyMessageRegexProtectionDescription>
{
  private justJoined: { [roomID: StringRoomID]: {user: StringUserID, time: number}[] } = {};
  private recentlyBanned: StringUserID[] = [];

  private readonly userConsequences: UserConsequences;
  private readonly eventConsequences: EventConsequences;
  private readonly disallowMedia: boolean;
  private readonly disallowList: RegExp[];
  constructor(
    description: EarlyMessageRegexProtectionDescription,
    lifetime: OwnLifetime<EarlyMessageRegexProtectionDescription>,
    capabilities: EarlyMessageRegexProtectionCapabilities,
    protectedRoomsSet: ProtectedRoomsSet,
    private readonly draupnir: Draupnir,
    settings: EarlyMessageRegexProtectionSettings,
  ) {
    super(description, lifetime, capabilities, protectedRoomsSet, {});
    this.userConsequences = capabilities.userConsequences;
    this.eventConsequences = capabilities.eventConsequences;
    this.disallowMedia = settings.disallowMedia;
    this.disallowList = settings.disallowList.flatMap(str => {
      try {
        return new RegExp(str, 'i');
      } catch (e) {
        log.warn(`[disallowList] could not parse RegExp value ${str}`)
        return [];
      }
    });
  }

  public async handleMembershipChange(
    revision: RoomMembershipRevision,
    changes: MembershipChange[]
  ): Promise<ActionResult<void>> {
    const roomID = revision.room.toRoomIDOrAlias();
    if (!this.justJoined[roomID]) this.justJoined[roomID] = [];
    for (const change of changes) {
      if (change.membershipChangeType === MembershipChangeType.Joined) {
        this.justJoined[roomID].push({user: change.userID, time: Date.now()});
      }
    }
    return Ok(undefined);
  }

  public async handleTimelineEvent(
    room: MatrixRoomID,
    event: RoomEvent
  ): Promise<ActionResult<void>> {
    const roomID = room.toRoomIDOrAlias();
    if (!this.justJoined[roomID]) this.justJoined[roomID] = [];
    if (Value.Check(RoomMessage, event)) {
      if (!("msgtype" in event.content)) {
        return Ok(undefined);
      }
      const coolDownTime = 10 * 60 * 1000; // 10 min
      const coolDownDate = Date.now() - coolDownTime;
      this.justJoined[roomID] = this.justJoined[roomID].filter(elem => {
        if(elem.time < coolDownDate) {
          LogService.info(
            "EarlyMessageRegex",
            `${event["sender"]} is no longer considered suspect`
          );
          return false;
        }
        return true;
      });
      const idx = this.justJoined[roomID].findIndex(
              (elem) => elem.user == event["sender"]
      );
      if( idx < 0) {
        return Ok(undefined);
      }
      const msgtype = event.content["msgtype"];
      const isMedia =
        msgtype === "m.image" ||
        msgtype === "m.video";
      const disallowedMedia = this.disallowMedia && isMedia;
      const formattedBody =
        "formatted_body" in event.content
          ? event.content["formatted_body"] ||  ""
          : "";
      const body = "body" in event.content
        ? event.content["body"] ||  ""
          : "";
      const disallowedMsg = [body, formattedBody].some((msg) => {
        return this.disallowList.some((regex) => regex.test(msg))
      });
      if (disallowedMedia || disallowedMsg) {
        await this.draupnir.managementRoomOutput.logMessage(
          LogLevel.WARN,
          "EarlyMessageRegex",
          `Banning ${event["sender"]} for posting an disallowed content in the coolDownTime after joining in ${roomID}.`
        );
        if (!this.draupnir.config.noop) {
          await this.userConsequences.consequenceForUserInRoom(
            roomID,
            event["sender"],
            "spam"
          );
        } else {
          await this.draupnir.managementRoomOutput.logMessage(
            LogLevel.WARN,
            "EarlyMessageRegex",
            `Tried to ban ${event["sender"]} in ${roomID} but Draupnir is running in no-op mode`,
            roomID
          );
        }

        if (this.recentlyBanned.includes(event["sender"])) {
          return Ok(undefined); // already handled (will be redacted)
        }
        this.draupnir.unlistedUserRedactionQueue.addUser(event["sender"]);
        this.recentlyBanned.push(event["sender"]); // flag to reduce spam

        // Redact the event
        if (!this.draupnir.config.noop) {
          await this.eventConsequences.consequenceForEvent(
            roomID,
            event["event_id"],
            "spam"
          );
        } else {
          await this.draupnir.managementRoomOutput.logMessage(
            LogLevel.WARN,
            "EarlyMessageRegex",
            `Tried to redact ${event["event_id"]} in ${roomID} but Draupnir is running in no-op mode`,
            roomID
          );
        }
      }
    }
    return Ok(undefined);
  }
}

describeProtection<
  EarlyMessageRegexProtectionCapabilities,
  Draupnir,
  typeof EarlyMessageRegexProtectionSettings
>({
  name: "EarlyMessageRegexProtection",
  description:
    "If the first thing a user does after joining is to post an image or video, \
    they'll be banned for spam. This does not publish the ban to any of your ban lists.",
  capabilityInterfaces: {
    userConsequences: "UserConsequences",
    eventConsequences: "EventConsequences",
  },
  defaultCapabilities: {
    userConsequences: "StandardUserConsequences",
    eventConsequences: "StandardEventConsequences",
  },
  configSchema: EarlyMessageRegexProtectionSettings,
  factory: async function (
    description: EarlyMessageRegexProtectionDescription,
    lifetime: OwnLifetime<EarlyMessageRegexProtectionDescription>,
    protectedRoomsSet: ProtectedRoomsSet,
    draupnir: Draupnir,
    capabilities: EarlyMessageRegexProtectionCapabilities,
    settings: EarlyMessageRegexProtectionSettings
  ) {
    return Ok(
      new EarlyMessageRegexProtection(
        description,
        lifetime,
        capabilities,
        protectedRoomsSet,
        draupnir,
        settings
      )
    );
  },
});
