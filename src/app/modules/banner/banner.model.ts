import { model, Schema } from "mongoose";
import { BannerModel, IBanner } from "./banner.interface";

const bannerSchema = new Schema<IBanner, BannerModel>(
    {
        title: {
            type: String,
            required: true,
            trim: true,
        },
        name: {
            type: String,
            trim: true,
        },
        image: {
            type: String,
            required: true,
        },
        section: {
            type: String,
            trim: true,
            default: "GENERAL",
            index: true,
        },
        subtitle: {
            type: String,
            trim: true,
            default: "",
        },
        status: {
            type: String,
            enum: ["active", "inactive"],
            default: "active",
            index: true,
        },
        priority: {
            type: Number,
            default: 0,
        },
        link: {
            type: String,
            default: "",
        },
    },
    { timestamps: true }
);

export const Banner = model<IBanner, BannerModel>("Banner", bannerSchema);
