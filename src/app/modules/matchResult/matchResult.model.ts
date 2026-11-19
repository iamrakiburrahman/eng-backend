import { Schema, model } from 'mongoose';

const matchResultSchema = new Schema(
  {
    league: {
      type: Schema.Types.ObjectId,
      ref: 'League',
      required: false,
    },

    match: {
      type: Schema.Types.ObjectId,
      ref: 'Match',
      required: true,
    },

    team: {
      type: Schema.Types.ObjectId,
      ref: 'Team',
      required: true,
    },

    player: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: false,
    },

    eventType: {
      type: String,
      enum: [
        'goal',
        'assist',
        'yellow_card',
        'red_card',
        'foul',
        'substitution',
        'clean_sheet',
        'player_of_the_day',
        'sin_bin',
        'disrespect_to_referee',
        'gross_misconduct',
        'good_rating',
        'great_rating',
        'elite_rating',
        'playing_match',
      ],
      required: true,
    },

    eventMeta: {
      goalType: {
        type: String,
        enum: ['normal', 'penalty', 'header', 'own_goal', 'free_kick'],
        required: function () {
          return this.eventType === 'goal';
        },
      },

      // NEW: optional assist
      assist: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: false,
      },

      cardType: {
        type: String,
        enum: ['yellow', 'red'],
        required: function () {
          return (
            this.eventType === 'yellow_card' ||
            this.eventType === 'red_card'
          );
        },
      },

      substitutionType: {
        type: String,
        enum: ['in', 'out'],
        required: function () {
          return this.eventType === 'substitution';
        },
      },
    },

    minute: {
      type: Number,
      required: true,
      min: 0,
      max: 130,
    },

    addedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: false,
    },
  },
  {
    timestamps: true,
  }
);

matchResultSchema.index({ match: 1, eventType: 1 });
matchResultSchema.index({ player: 1, eventType: 1 });
matchResultSchema.index({ match: 1, player: 1, eventType: 1, minute: 1 });

export const MatchResult = model('MatchResult', matchResultSchema);