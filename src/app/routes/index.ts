import express from 'express';
import { UserRoutes } from '../modules/user/user.routes';
import { AuthRoutes } from '../modules/auth/auth.routes';
import AboutRoutes from '../modules/rule/rule.route';
import PrivacyPolicyRoutes from '../modules/rule/rule.route';
import TermsAndConditionRoutes from '../modules/rule/rule.route';
import NewsRoutes from '../modules/news/news.route';
import EventRoutes from '../modules/event/event.route';
import TeamRoutes from '../modules/team/team.route';
import MatchRoutes from '../modules/match/match.route';
import MatchResultRoute from '../modules/matchResult/matchResult.route';
import PointTableRoute from '../modules/poientTable/poientTable.route';
import PlayerStatsRoutes from '../modules/playerStats/playerStats.route';
import VideoRoutes from '../modules/video/video.route';
import LeagueRoute from '../modules/league/league.route'
import LeagueTeamRoute from '../modules/leagueTeam/leagueTeam.route'
import RewardProductsRoute from '../modules/rewardProduct/rewardProduct.route'
import RewardOrderRoute from '../modules/rewardOrder/rewardOrder.route'
import TransferRoute from '../modules/transfer/transfer.route'
import ManagerAssignRoute from "../modules/managerTeam/managerTeam.route"
import TeamDashboard from "../modules/teamDashboard/teamDashboard.route"
import PlayerDashboard from "../modules/playerDashboard/playerDashboard.route"
import playerRoute from "../modules/playermanagement/player.route"
import playerSelectionRoute from "../modules/matchPlayerSelection/matchPlayerSelection.route"
import UserManagementRoute from "../modules/userManagement/userManagement.route"
import NotificationRoute from "../modules/notification/notification.routes"
import PackageRoute from "../modules/package/package.routes"
import OverviewRoute from "../modules/overview/overview.route"
import PushNotificationRoute from "../modules/pushNotification/pushNotification.route"
import StatisticRoute from "../modules/statistic/statistic.route"
import RefereeRatingRoute from "../modules/refereeRating/refereeRating.route"
import CoinAndBudgetRoute from "../modules/coinAndBudget/coinAndBudget.route"
import GalleryRoutes from "../modules/gallery/gallery.route";
import SocialMediaRoutes from "../modules/socialMedia/socialMedia.route";
import EngTvCategoryRoutes from "../modules/engTvCategory/engTvCategory.route";
import VenueCategoryRoutes from "../modules/venueCategory/venueCategory.route";
import PlayTimeCategoryRoutes from "../modules/playTimeCategory/playTimeCategory.route";
import AgeGroupCategoryRoutes from "../modules/ageGroupCategory/ageGroupCategory.route";
import GalleryCategoryRoutes from "../modules/galleryCategory/galleryCategory.route";
import NewsCategoryRoutes from "../modules/newsCategory/newsCategory.route";
import TournamentRoutes from "../modules/tournament/tournament.route";
import TournamentClaimRoutes from "../modules/tournamentClaim/tournamentClaim.route";
import CoinTransactionRoute from "../modules/coinTransaction/coinTransaction.route";
import StatsAuditRoute from "../modules/statsAudit/statsAudit.route";
import { TeamSubscriptionRoutes } from "../modules/teamSubscription/teamSubscription.route";
import { AdminRoutes } from "../modules/admin/admin.route";
import { ServerHealthRoutes } from "../modules/serverHealth/serverHealth.route";
import { TeamCoinTransactionRoutes } from "../modules/teamCoinTransaction/teamCoinTransaction.route";
import { SponsorshipRoutes } from "../modules/sponsorship/sponsorship.route";
import { PlayerVotingRoutes } from "../modules/playerVoting/playerVoting.route";
import { QuizRoutes } from "../modules/quiz/quiz.route";
import { ScorePredictionRoutes } from "../modules/scorePrediction/scorePrediction.route";
import { RefereeVotingRoutes } from "../modules/refereeVoting/refereeVoting.route";

const router = express.Router();

const apiRoutes = [
    { path: "/user", route: UserRoutes },
    { path: "/profile", route: UserRoutes },
    { path: "/user-management", route: UserManagementRoute },
    { path: "/auth", route: AuthRoutes },
    { path: "/about", route: AboutRoutes },
    { path: "/", route: PrivacyPolicyRoutes },
    { path: "/", route: TermsAndConditionRoutes },
    { path: "/news", route: NewsRoutes },
    { path: "/event", route: EventRoutes },
    { path: "/team", route: TeamRoutes },
    { path: "/match", route: MatchRoutes },
    { path: "/match-result", route: MatchResultRoute },
    { path: "/point-table", route: PointTableRoute },
    { path: "/player-stats", route: PlayerStatsRoutes },
    { path: "/playerStats", route: PlayerStatsRoutes },
    { path: "/video", route: VideoRoutes },
    { path: "/league", route: LeagueRoute },
    { path: "/league-team", route: LeagueTeamRoute },
    { path: "/reward-products", route: RewardProductsRoute },
    { path: "/reward-order", route: RewardOrderRoute },
    { path: "/transfers", route: TransferRoute },
    { path: "/manager-team", route: ManagerAssignRoute},
    { path: "/team-dashboard", route: TeamDashboard},
    { path: "/player-dashboard", route: PlayerDashboard},
    { path: "/player", route: playerRoute },
    { path: "/player-selection", route: playerSelectionRoute },
    { path: "/notification", route: NotificationRoute},
    { path: "/package", route: PackageRoute},
    { path: "/overview", route: OverviewRoute },
    { path: "/push-notification", route: PushNotificationRoute },
    { path: "/statistic", route: StatisticRoute },
    { path: "/referee", route: RefereeRatingRoute },
    { path: "/coin-budget", route: CoinAndBudgetRoute },
    { path: "/gallery", route: GalleryRoutes },
    { path: "/social-media", route: SocialMediaRoutes },
    { path: "/eng-tv-category", route: EngTvCategoryRoutes },
    { path: "/venue-category", route: VenueCategoryRoutes },
    { path: "/playtime-category", route: PlayTimeCategoryRoutes },
    { path: "/age-group-category", route: AgeGroupCategoryRoutes },
    { path: "/gallery-category", route: GalleryCategoryRoutes },
    { path: "/news-category", route: NewsCategoryRoutes },
    { path: "/tournament", route: TournamentRoutes },
    { path: "/tournament-claim", route: TournamentClaimRoutes },
    { path: "/coins", route: CoinTransactionRoute },
    { path: "/team-coins", route: TeamCoinTransactionRoutes },
    { path: "/stats-audit", route: StatsAuditRoute },
    { path: "/team-subscription", route: TeamSubscriptionRoutes },
    { path: "/admin", route: AdminRoutes },
    { path: "/server-health", route: ServerHealthRoutes },
    { path: "/sponsorship", route: SponsorshipRoutes },
    { path: "/sponsors", route: SponsorshipRoutes },
    { path: "/player-voting", route: PlayerVotingRoutes },
    { path: "/statistic/voting", route: PlayerVotingRoutes },
    { path: "/quiz", route: QuizRoutes },
    { path: "/quizzes", route: QuizRoutes },
    { path: "/score-prediction", route: ScorePredictionRoutes },
    { path: "/prediction", route: ScorePredictionRoutes },
    { path: "/referee-voting", route: RefereeVotingRoutes },
    { path: "/ref-voting", route: RefereeVotingRoutes },
]

apiRoutes.forEach(route => router.use(route.path, route.route));
export default router;