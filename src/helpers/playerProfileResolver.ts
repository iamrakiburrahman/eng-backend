import { StatusCodes } from 'http-status-codes';
import { Types } from 'mongoose';
import ApiError from '../errors/ApiErrors';
import { User } from '../app/modules/user/user.model';
import { USER_ROLES } from '../enums/user';

/**
 * Resolves the effective Player profile for Player-only actions (Score Prediction, Quiz).
 * - A registered PLAYER can participate directly or as their own profile.
 * - A PARENT can only participate by specifying their child's player profileId.
 * - Rewarded ENG coins will strictly flow into the resolved Player's wallet.
 */
export const resolveEffectivePlayerForAction = async (
  authUserId: string,
  requestedProfileId?: string
): Promise<any> => {
  if (!authUserId || !Types.ObjectId.isValid(authUserId)) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'Authentication is required.');
  }

  const authUser = await User.findById(authUserId);
  if (!authUser) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Authenticated user not found.');
  }

  // Case 1: Specific profileId requested by user or parent
  if (requestedProfileId && Types.ObjectId.isValid(requestedProfileId)) {
    const profileIdStr = requestedProfileId.toString();

    // If profileId matches authUserId
    if (profileIdStr === authUserId.toString()) {
      // Check if user is a player
      if (
        authUser.role === USER_ROLES.PLAYER ||
        authUser.role === USER_ROLES.TOURNAMENT_PLAYER
      ) {
        return authUser;
      }
      throw new ApiError(
        StatusCodes.FORBIDDEN,
        'Only registered players can participate. Parents must select a child player profile.'
      );
    }

    // Check if requested profileId is a child of this parent
    const child = await User.findOne({
      _id: requestedProfileId,
      parentId: authUser._id,
    });

    if (child) {
      return child;
    }

    // Check if authUser is a child and requested a sibling under the same parent
    if (authUser.parentId) {
      const sibling = await User.findOne({
        _id: requestedProfileId,
        parentId: authUser.parentId,
      });
      if (sibling) {
        return sibling;
      }
    }

    throw new ApiError(
      StatusCodes.FORBIDDEN,
      'The selected player profile does not belong to your account.'
    );
  }

  // Case 2: No profileId specified in request
  // Check if authUser has child player profiles (e.g. is a parent)
  const children = await User.find({ parentId: authUser._id });

  if (children.length === 1 && children[0]) {
    // If parent has exactly 1 child, conveniently default to that child player
    return children[0];
  }

  if (children.length > 1) {
    // If parent has multiple children, require selecting one
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'Multiple player profiles found. Please provide profileId to select which child player is participating.'
    );
  }

  // If user has no children, check if user themselves is a player
  if (
    authUser.role === USER_ROLES.PLAYER ||
    authUser.role === USER_ROLES.TOURNAMENT_PLAYER
  ) {
    return authUser;
  }

  throw new ApiError(
    StatusCodes.FORBIDDEN,
    'Only registered players (or parents on behalf of their child player) can participate.'
  );
};
