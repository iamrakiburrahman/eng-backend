import { Model, Types } from "mongoose";

export type TBannerStatus = 'active' | 'inactive';

export type IBanner = {
    _id?: Types.ObjectId | string;
    title: string;
    name?: string;
    image: string;
    section?: string;
    subtitle?: string;
    status: TBannerStatus;
    priority?: number;
    link?: string;
    createdAt?: Date;
    updatedAt?: Date;
}

export type BannerModel = Model<IBanner>;
