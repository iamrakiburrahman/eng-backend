import { Schema, model } from "mongoose";

export interface IMatchSetting {
  feedbackWindowHours: number;
  isFeedbackWindowRestricted: boolean;
  timezone: string;

  // Dynamic Upcoming Match Reminder Settings
  isMatchReminderEnabled: boolean;
  matchReminderHours: number;
  matchReminderAudience: 'STAKEHOLDERS' | 'ALL';
  customReminderTitle?: string;
  customReminderMessage?: string;
}

const matchSettingSchema = new Schema<IMatchSetting>(
  {
    feedbackWindowHours: {
      type: Number,
      default: 24,
      min: 0,
    },
    isFeedbackWindowRestricted: {
      type: Boolean,
      default: true,
    },
    timezone: {
      type: String,
      default: "Europe/London",
    },

    isMatchReminderEnabled: {
      type: Boolean,
      default: true,
    },
    matchReminderHours: {
      type: Number,
      default: 24,
      min: 1,
      max: 168,
    },
    matchReminderAudience: {
      type: String,
      enum: ['STAKEHOLDERS', 'ALL'],
      default: 'STAKEHOLDERS',
    },
    customReminderTitle: {
      type: String,
      default: 'Match Reminder: {homeTeam} vs {awayTeam}',
    },
    customReminderMessage: {
      type: String,
      default: 'Upcoming match: {homeTeam} vs {awayTeam} kicks off tomorrow ({date}) at {time}{venue}. Don\'t miss it!',
    },
  },
  {
    timestamps: true,
  }
);

export const MatchSetting = model<IMatchSetting>("MatchSetting", matchSettingSchema);

export const getEffectiveMatchSetting = async (): Promise<IMatchSetting> => {
  let setting = await MatchSetting.findOne();
  if (!setting) {
    setting = await MatchSetting.create({
      feedbackWindowHours: 24,
      isFeedbackWindowRestricted: true,
      timezone: "Europe/London",
      isMatchReminderEnabled: true,
      matchReminderHours: 24,
      matchReminderAudience: 'STAKEHOLDERS',
      customReminderTitle: 'Match Reminder: {homeTeam} vs {awayTeam}',
      customReminderMessage: 'Upcoming match: {homeTeam} vs {awayTeam} kicks off tomorrow ({date}) at {time}{venue}. Don\'t miss it!',
    });
  }
  return setting;
};
