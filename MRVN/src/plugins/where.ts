import { decorators as d, IPluginOptions, Plugin, logger, getInviteLink } from "knub";
import { Message, TextableChannel, Member, Channel, VoiceChannel, Guild, User, Invite } from "eris";
import humanizeDuration from "humanize-duration";
import moment from "moment-timezone";
import { createInvite } from "./lfg";
import { UnknownUser, resolveMember, errorMessage, successMessage } from "../utils";

interface IWherePluginConfig {
  where_timeout: number;

  can_where: boolean;
  can_notify: boolean;
  can_follow: boolean;
}

class Notification {
  modId: string;
  subjectId: string;
  channelId: string;
  endTime: number;
  persist: boolean;
  activeFollow: boolean;

  constructor(
    modId: string,
    subjectId: string,
    channelId: string,
    endTime: number,
    persist: boolean,
    activeFollow: boolean,
  ) {
    this.modId = modId;
    this.subjectId = subjectId;
    this.channelId = channelId;
    this.endTime = endTime;
    this.persist = persist;
    this.activeFollow = activeFollow;
  }
}

export class WherePlugin extends Plugin<IWherePluginConfig> {
  public static pluginName = "where";
  private activeNotifications: Array<Notification> = [];
  private activeVCNotifications: Array<Notification> = [];

  getDefaultOptions(): IPluginOptions<IWherePluginConfig> {
    return {
      config: {
        where_timeout: 600000,
        can_where: false,
        can_notify: false,
        can_follow: false,
      },
      overrides: [
        {
          level: ">=50",
          config: {
            can_where: true,
            can_notify: true,
            can_follow: true,
          },
        },
      ],
    };
  }

  @d.command("where", "<user:resolvedUserLoose>", {
    aliases: ["w"],
  })
  @d.permission("can_where")
  async whereRequest(msg: Message, args: { user: User | UnknownUser }): Promise<void> {
    let member: Member;
    if (!(args.user instanceof UnknownUser)) {
      // member = await resolveMember(this.bot, this.guild, args.user.id);
      try {
        member = await this.bot.getRESTGuildMember(this.guildId, args.user.id);
      } catch (err) {
        console.error(err);
      }
    } else {
      this.sendErrorMessage(msg.channel, "Unknown user/member! Is the ID correct?");
      return;
    }
    sendWhere(this.guild, member, msg.channel, msg.author.mention + " ");

    logger.info(
      `${msg.author.id}: ${msg.author.username}#${msg.author.discriminator} Requested where for ${member.id}`,
    );
  }

  @d.command("notify", "<user:resolvedUserLoose> [time:delay]", {
    aliases: ["n"],
  })
  @d.permission("can_notify")
  async notifyRequest(msg: Message, args: { user: User | UnknownUser; time?: number }): Promise<void> {
    let member: Member;
    if (!(args.user instanceof UnknownUser)) {
      member = await resolveMember(this.bot, this.guild, args.user.id);
    } else {
      this.sendErrorMessage(msg.channel, "Unknown user/member! Is the ID correct?");
      return;
    }

    const cfg: IWherePluginConfig = this.getConfig();
    let timeout: any = args.time != null ? args.time : cfg.where_timeout;

    const endTime: any = moment().add(timeout, "ms");
    this.activeNotifications.push(new Notification(msg.author.id, member.id, msg.channel.id, endTime, false, false));
    msg.channel.createMessage(
      `If <@!${member.id}> joins or switches VC in the next ${humanizeDuration(timeout)} i will notify you`,
    );

    logger.info(
      `${msg.author.id}: ${msg.author.username}#${msg.author.discriminator} Requested notify for ${member.id}`,
    );
  }

  @d.command("vcnotify", "<channelId:string> [time:delay]", {
    aliases: ["v", "vc", "vcn"],
  })
  @d.permission("can_notify")
  async vcNotifyRequest(msg: Message, args: { channelId: string; time?: number }): Promise<void> {
    const cfg: IWherePluginConfig = this.getConfig();
    const timeout: any = args.time != null ? args.time : cfg.where_timeout;

    const channel: VoiceChannel = <VoiceChannel>this.bot.getChannel(args.channelId);
    if (channel == null) {
      this.sendErrorMessage(msg.channel, "Couldnt find channel");
      return;
    }

    const endTime: any = moment().add(timeout, "ms");
    this.activeVCNotifications.push(
      new Notification(msg.author.id, args.channelId, msg.channel.id, endTime, false, false),
    );
    msg.channel.createMessage(
      `I will notify you of all changes in \`${channel.name}\` for the next ${humanizeDuration(timeout)}`,
    );

    logger.info(
      `${msg.author.id}: ${msg.author.username}#${msg.author.discriminator} Requested notify for vc ${args.channelId}`,
    );
  }

  @d.command("follow", "<user:resolvedUserLoose> [time:delay]", {
    aliases: ["f"],
    options: [
      {
        name: "active",
        isSwitch: true,
        shortcut: "a",
      },
    ],
  })
  @d.permission("can_follow")
  async followRequest(
    msg: Message,
    args: { user: User | UnknownUser; time?: number; active?: boolean },
  ): Promise<void> {
    const cfg: IWherePluginConfig = this.getConfig();
    const timeout: any = args.time != null ? args.time : cfg.where_timeout;
    const active: boolean = args.active != null ? args.active : false;

    let member: Member;
    if (!(args.user instanceof UnknownUser)) {
      member = await resolveMember(this.bot, this.guild, args.user.id);
    } else {
      this.sendErrorMessage(msg.channel, "Unknown user/member! Is the ID correct?");
      return;
    }

    const endTime: any = moment().add(timeout, "ms");
    this.activeNotifications.push(new Notification(msg.author.id, member.id, msg.channel.id, endTime, true, active));

    if (!active) {
      msg.channel.createMessage(
        `I will let you know each time <@!${member.id}> switches channel in the next ${humanizeDuration(timeout)}`,
      );
    } else {
      msg.channel.createMessage(
        `I will let you know each time <@!${member.id}> switches channel in the next ${humanizeDuration(
          timeout,
        )}.\nI will also move you to the users channel, please join a voice channel now so that i can move you!`,
      );
    }

    logger.info(
      `${msg.author.id}: ${msg.author.username}#${msg.author.discriminator} Requested follow for ${member.id} - Active Follow: ${active}`,
    );
  }

  @d.command("follow stop", "<user:resolvedUserLoose>", {
    aliases: ["fs", "fd", "ns", "nd"],
  })
  @d.permission("can_follow")
  async followStopRequest(msg: Message, args: { user: User | UnknownUser }): Promise<void> {
    this.removeNotifyforUserId(args.user.id);
    msg.channel.createMessage(successMessage(`Deleted all your follow and notify requests for <@!${args.user.id}>!`));
    logger.info(
      `${msg.author.id}: ${msg.author.username}#${msg.author.discriminator} Requested notify/follow deletion for ${args.user.id}`,
    );
  }

  @d.event("voiceChannelJoin")
  async userJoinedVC(member: Member, newChannel: Channel): Promise<void> {
    let active: boolean = false;

    this.activeNotifications.forEach(async notif => {
      if (notif.subjectId === member.id) {
        if (notif.endTime >= Date.now()) {
          const channel: TextableChannel = <TextableChannel>this.bot.getChannel(notif.channelId);
          sendWhere(
            this.guild,
            member,
            channel,
            "<@!" + notif.modId + "> a notification requested by you has triggered:\n",
          );

          if (notif.activeFollow) {
            const modMember: Member = await this.bot.getRESTGuildMember(this.guildId, notif.modId);
            if (modMember.voiceState.channelID != null) {
              try {
                await modMember.edit({
                  channelID: newChannel.id,
                });
              } catch (e) {
                channel.createMessage(errorMessage("Failed to move you. Are you in a voice channel?"));
                return;
              }
            }
          }

          if (!notif.persist) {
            active = true;
          }
        } else {
          active = true;
        }
      }
    });

    if (active) {
      this.removeNotifyforUserId(member.id);
    }

    active = false;
    this.activeVCNotifications.forEach(notif => {
      if (notif.subjectId === newChannel.id) {
        if (Date.now() >= notif.endTime) {
          active = true;
        } else {
          const text: TextableChannel = <TextableChannel>this.bot.getChannel(notif.channelId);
          const voice: VoiceChannel = <VoiceChannel>this.bot.getChannel(notif.subjectId);
          text.createMessage(`🔵 <@!${notif.modId}> The user <@!${member.id}> joined the channel \`${voice.name}\``);
        }
      }
    });

    if (active) {
      this.removeVCNotifyforUserId(member.id);
    }
  }

  @d.event("voiceChannelSwitch")
  async userSwitchedVC(member: Member, newChannel: Channel, oldChannel: Channel): Promise<void> {
    let active: boolean = false;
    const newVoice: VoiceChannel = <VoiceChannel>this.bot.getChannel(newChannel.id);
    const oldVoice: VoiceChannel = <VoiceChannel>this.bot.getChannel(oldChannel.id);

    this.activeNotifications.forEach(async notif => {
      if (notif.subjectId === member.id) {
        if (notif.endTime >= Date.now()) {
          const channel: TextableChannel = <TextableChannel>this.bot.getChannel(notif.channelId);
          sendWhere(
            this.guild,
            member,
            channel,
            "<@!" + notif.modId + "> a notification requested by you has triggered:\n",
          );

          if (notif.activeFollow) {
            const modMember: Member = await this.bot.getRESTGuildMember(this.guildId, notif.modId);
            if (modMember.voiceState.channelID != null) {
              try {
                await modMember.edit({
                  channelID: newChannel.id,
                });
              } catch (e) {
                channel.createMessage(errorMessage("Failed to move you. Are you in a voice channel?"));
                return;
              }
            }
          }

          if (!notif.persist) {
            active = true;
          }
        } else {
          active = true;
        }
      }
    });

    if (active) {
      this.removeNotifyforUserId(member.id);
    }

    active = false;
    this.activeVCNotifications.forEach(notif => {
      if (notif.subjectId === newChannel.id) {
        if (Date.now() >= notif.endTime) {
          active = true;
        } else {
          const text: TextableChannel = <TextableChannel>this.bot.getChannel(notif.channelId);
          text.createMessage(
            `🔵 <@!${notif.modId}> The user <@!${member.id}> switched to the channel \`${newVoice.name}\` from \`${oldVoice.name}\``,
          );
        }
      }
    });

    this.activeVCNotifications.forEach(notif => {
      if (notif.subjectId === oldChannel.id) {
        if (Date.now() >= notif.endTime) {
          active = true;
        } else {
          const text: TextableChannel = <TextableChannel>this.bot.getChannel(notif.channelId);
          text.createMessage(
            `🔴 <@!${notif.modId}> The user <@!${member.id}> switched out of the channel \`${oldVoice.name}\` and joined \`${newVoice.name}\``,
          );
        }
      }
    });

    if (active) {
      this.removeVCNotifyforUserId(member.id);
    }
  }

  @d.event("voiceChannelLeave")
  async userLeftVC(member: Member, channel: Channel): Promise<void> {
    let active: boolean = false;

    this.activeVCNotifications.forEach(notif => {
      if (notif.subjectId === channel.id) {
        if (Date.now() >= notif.endTime) {
          active = true;
        } else {
          const text: TextableChannel = <TextableChannel>this.bot.getChannel(notif.channelId);
          const voice: VoiceChannel = <VoiceChannel>this.bot.getChannel(notif.subjectId);
          text.createMessage(
            `🔴 <@!${notif.modId}> The user <@!${member.id}> disconnected out of the channel \`${voice.name}\``,
          );
        }
      }
    });

    if (active) {
      this.removeVCNotifyforUserId(member.id);
    }

    this.activeNotifications.forEach(async notif => {
      if (notif.subjectId === member.id) {
        if (notif.endTime >= Date.now()) {
          if (notif.persist) {
            const tchannel: TextableChannel = <TextableChannel>this.bot.getChannel(notif.channelId);
            const voice: VoiceChannel = <VoiceChannel>this.bot.getChannel(channel.id);
            tchannel.createMessage(
              `<@!${notif.modId}> The user <@!${member.id}> disconnected out of the channel \`${voice.name}\``,
            );
          }
        } else {
          active = true;
        }
      }
    });

    if (active) {
      this.removeNotifyforUserId(member.id);
    }
  }

  async removeNotifyforUserId(userId: string): Promise<void> {
    let newNotifies: Array<Notification> = [];

    for (let index: any = 0; index < this.activeNotifications.length; index++) {
      const notif: Notification = this.activeNotifications[index];
      if (notif.subjectId !== userId) {
        newNotifies.push(notif);
      }
    }

    this.activeNotifications = newNotifies;
  }

  async removeVCNotifyforUserId(userId: string): Promise<void> {
    let newNotifies: Array<Notification> = [];

    for (let index: any = 0; index < this.activeVCNotifications.length; index++) {
      const notif: Notification = this.activeVCNotifications[index];
      if (notif.subjectId !== userId) {
        newNotifies.push(notif);
      }
    }

    this.activeVCNotifications = newNotifies;
  }
}

export async function sendWhere(
  guild: Guild,
  member: Member,
  channel: TextableChannel,
  prepend?: string,
): Promise<void> {
  let voice: VoiceChannel = null;
  try {
    voice = <VoiceChannel>guild.channels.get(member.voiceState.channelID);
  } catch (e) {
    channel.createMessage(errorMessage("Could not retrieve information on that user!\nAre they on the server?"));
    return;
  }

  if (voice == null) {
    channel.createMessage(prepend + "That user is not in a channel");
  } else {
    let invite: Invite = null;
    try {
      invite = await createInvite(voice);
    } catch (e) {
      channel.createMessage(errorMessage(`Could not create an invite to that channel!\nReason: \`${e}\``));
      logger.info(`${e}\nGuild: ${guild.name}\nMember: ${member.id}\nPrepend: ${prepend}`);
      return;
    }
    channel.createMessage(
      `${prepend} <@!${member.id}> is in the following channel: \`${voice.name}\` ${getInviteLink(invite)}`,
    );
  }
}
