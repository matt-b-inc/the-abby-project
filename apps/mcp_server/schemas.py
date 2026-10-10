"""Pydantic v2 input schemas for MCP tools.

All schemas live here so the tool modules stay small and so schemas are easy
to import from tests. Field names match the corresponding REST API payloads
where possible so Claude can learn them from either surface.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


# ---------------------------------------------------------------------------
# Shared
# ---------------------------------------------------------------------------


class _Base(BaseModel):
    model_config = ConfigDict(extra="forbid")


# ---------------------------------------------------------------------------
# Projects
# ---------------------------------------------------------------------------


ProjectStatus = Literal[
    "draft", "active", "in_progress", "in_review", "completed", "archived",
]
PaymentKind = Literal["required", "bounty"]


class ListProjectsIn(_Base):
    status: Optional[ProjectStatus] = None
    assigned_to_id: Optional[int] = None
    limit: int = Field(default=50, ge=1, le=200)


class GetProjectIn(_Base):
    project_id: int


class NewMilestoneSkillTag(_Base):
    skill_id: int
    xp_amount: int = Field(default=15, ge=0)


class NewMilestone(_Base):
    title: str = Field(min_length=1, max_length=200)
    description: str = ""
    order: int = 0
    bonus_amount: Optional[Decimal] = None
    skill_tags: list[NewMilestoneSkillTag] = Field(default_factory=list)


class NewProjectSkillTag(_Base):
    skill_id: int
    xp_weight: int = Field(default=1, ge=1)


ResourceType = Literal["link", "video", "doc", "image"]


class NewStep(_Base):
    """An ordered walkthrough instruction (not a payment milestone).

    Marked complete to signal progress; never awards XP, coins, or money.

    ``milestone_index`` (when set) is a 0-based index into the ``milestones``
    array on the same ``create_project`` call — the step is grouped under
    that milestone in the UI's Plan view. Leave as ``None`` for a loose /
    ungrouped step.
    """
    title: str = Field(min_length=1, max_length=200)
    description: str = ""
    order: int = 0
    milestone_index: Optional[int] = None


class NewResource(_Base):
    """A reference link attached to a project, or to a specific step.

    ``step_index`` is a 0-based index into the ``steps`` array on the same
    ``create_project`` call. Leave as ``None`` for a project-level reference
    shown on the project Overview.
    """
    title: str = ""
    url: str = Field(min_length=1, max_length=1000)
    resource_type: ResourceType = "link"
    order: int = 0
    step_index: Optional[int] = None


class CreateProjectIn(_Base):
    title: str = Field(min_length=1, max_length=200)
    description: str = ""
    assigned_to_id: int
    difficulty: int = Field(default=1, ge=1, le=5)
    category_id: Optional[int] = None
    bonus_amount: Decimal = Decimal("0.00")
    payment_kind: PaymentKind = "required"
    materials_budget: Decimal = Decimal("0.00")
    hourly_rate_override: Optional[Decimal] = None
    due_date: Optional[date] = None
    status: ProjectStatus = "active"
    milestones: list[NewMilestone] = Field(default_factory=list)
    skill_tags: list[NewProjectSkillTag] = Field(default_factory=list)
    # Walkthrough content. Projects created via MCP without an Instructables
    # URL should populate ``steps`` so the child has "do this next" guidance;
    # ``resources`` can attach per-step videos or project-level references.
    steps: list[NewStep] = Field(default_factory=list)
    resources: list[NewResource] = Field(default_factory=list)


class UpdateProjectStatusIn(_Base):
    project_id: int
    status: ProjectStatus


class CompleteMilestoneIn(_Base):
    milestone_id: int
    notes: str = ""


# --- Tier 1.1: Project editing + nested CRUD ------------------------------


class UpdateProjectIn(_Base):
    project_id: int
    title: Optional[str] = Field(default=None, min_length=1, max_length=200)
    description: Optional[str] = None
    assigned_to_id: Optional[int] = None
    difficulty: Optional[int] = Field(default=None, ge=1, le=5)
    category_id: Optional[int] = None
    bonus_amount: Optional[Decimal] = None
    payment_kind: Optional[PaymentKind] = None
    materials_budget: Optional[Decimal] = None
    hourly_rate_override: Optional[Decimal] = None
    due_date: Optional[date] = None
    parent_notes: Optional[str] = None
    instructables_url: Optional[str] = None


class DeleteProjectIn(_Base):
    project_id: int


class ProjectActionIn(_Base):
    project_id: int


class RequestProjectChangesIn(_Base):
    project_id: int
    parent_notes: str = ""


class AddMilestoneIn(_Base):
    project_id: int
    title: str = Field(min_length=1, max_length=200)
    description: str = ""
    order: int = 0
    bonus_amount: Optional[Decimal] = None
    skill_tags: list[NewMilestoneSkillTag] = Field(default_factory=list)


class UpdateMilestoneIn(_Base):
    milestone_id: int
    title: Optional[str] = Field(default=None, min_length=1, max_length=200)
    description: Optional[str] = None
    order: Optional[int] = None
    bonus_amount: Optional[Decimal] = None
    skill_tags: Optional[list[NewMilestoneSkillTag]] = None


class DeleteMilestoneIn(_Base):
    milestone_id: int


class AddStepIn(_Base):
    project_id: int
    title: str = Field(min_length=1, max_length=200)
    description: str = ""
    order: int = 0
    milestone_id: Optional[int] = None


class UpdateStepIn(_Base):
    step_id: int
    title: Optional[str] = Field(default=None, min_length=1, max_length=200)
    description: Optional[str] = None
    order: Optional[int] = None
    milestone_id: Optional[int] = None
    clear_milestone: bool = Field(
        default=False,
        description="Set true to explicitly unset the step's milestone (pass "
                    "milestone_id=None). Needed because a null milestone_id "
                    "would otherwise be treated as 'don't change'.",
    )


class DeleteStepIn(_Base):
    step_id: int


class StepActionIn(_Base):
    step_id: int


class AddMaterialIn(_Base):
    project_id: int
    name: str = Field(min_length=1, max_length=200)
    description: str = ""
    estimated_cost: Decimal = Field(default=Decimal("0.00"), ge=Decimal("0"))


class UpdateMaterialIn(_Base):
    material_id: int
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    description: Optional[str] = None
    estimated_cost: Optional[Decimal] = None
    actual_cost: Optional[Decimal] = None
    is_purchased: Optional[bool] = None


class DeleteMaterialIn(_Base):
    material_id: int


class AddResourceIn(_Base):
    project_id: int
    url: str = Field(min_length=1, max_length=1000)
    title: str = ""
    resource_type: ResourceType = "link"
    order: int = 0
    step_id: Optional[int] = None


class UpdateResourceIn(_Base):
    resource_id: int
    url: Optional[str] = Field(default=None, min_length=1, max_length=1000)
    title: Optional[str] = None
    resource_type: Optional[ResourceType] = None
    order: Optional[int] = None
    step_id: Optional[int] = None
    clear_step: bool = False


class DeleteResourceIn(_Base):
    resource_id: int


# --- Tier 1.2: Project templates ------------------------------------------


class TemplateMilestoneDraft(_Base):
    title: str = Field(min_length=1, max_length=200)
    description: str = ""
    order: int = 0
    bonus_amount: Optional[Decimal] = None


class TemplateMaterialDraft(_Base):
    name: str = Field(min_length=1, max_length=200)
    description: str = ""
    estimated_cost: Decimal = Decimal("0.00")


class TemplateStepDraft(_Base):
    title: str = Field(min_length=1, max_length=200)
    description: str = ""
    order: int = 0
    milestone_index: Optional[int] = None


class TemplateResourceDraft(_Base):
    url: str = Field(min_length=1, max_length=1000)
    title: str = ""
    resource_type: ResourceType = "link"
    order: int = 0
    step_index: Optional[int] = None


class ListTemplatesIn(_Base):
    is_public_only: bool = False
    limit: int = Field(default=50, ge=1, le=200)


class GetTemplateIn(_Base):
    template_id: int


class CreateTemplateIn(_Base):
    title: str = Field(min_length=1, max_length=200)
    description: str = ""
    instructables_url: Optional[str] = None
    difficulty: int = Field(default=1, ge=1, le=5)
    category_id: Optional[int] = None
    bonus_amount: Decimal = Decimal("0.00")
    materials_budget: Decimal = Decimal("0.00")
    is_public: bool = False
    milestones: list[TemplateMilestoneDraft] = Field(default_factory=list)
    materials: list[TemplateMaterialDraft] = Field(default_factory=list)
    steps: list[TemplateStepDraft] = Field(default_factory=list)
    resources: list[TemplateResourceDraft] = Field(default_factory=list)


class UpdateTemplateIn(_Base):
    template_id: int
    title: Optional[str] = Field(default=None, min_length=1, max_length=200)
    description: Optional[str] = None
    instructables_url: Optional[str] = None
    difficulty: Optional[int] = Field(default=None, ge=1, le=5)
    category_id: Optional[int] = None
    bonus_amount: Optional[Decimal] = None
    materials_budget: Optional[Decimal] = None
    is_public: Optional[bool] = None


class DeleteTemplateIn(_Base):
    template_id: int


class SaveProjectAsTemplateIn(_Base):
    project_id: int
    is_public: bool = False


class CreateProjectFromTemplateIn(_Base):
    template_id: int
    assigned_to_id: int
    title_override: Optional[str] = Field(
        default=None, min_length=1, max_length=200,
    )


class SetProjectSkillTagsIn(_Base):
    project_id: int
    skill_tags: list[NewProjectSkillTag]


class MarkMaterialPurchasedIn(_Base):
    material_id: int
    actual_cost: Optional[Decimal] = None


# ---------------------------------------------------------------------------
# Rewards / Coins
# ---------------------------------------------------------------------------


class ListRewardsIn(_Base):
    active_only: bool = True


class GetCoinBalanceIn(_Base):
    user_id: Optional[int] = None


class RequestRedemptionIn(_Base):
    reward_id: int


class DecideRedemptionIn(_Base):
    redemption_id: int
    notes: str = ""


# --- Tier 1.3: Reward shop CRUD -------------------------------------------


RewardFulfillmentKind = Literal["real_world", "digital_item", "both"]


class CreateRewardIn(_Base):
    name: str = Field(min_length=1, max_length=100)
    description: str = ""
    icon: str = ""
    cost_coins: int = Field(ge=0)
    rarity: BadgeRarity = "common"
    stock: Optional[int] = Field(default=None, ge=0)
    requires_parent_approval: bool = True
    is_active: bool = True
    order: int = 0
    fulfillment_kind: RewardFulfillmentKind = "real_world"
    item_definition_slug: Optional[str] = Field(
        default=None,
        description="Optional RPG ItemDefinition slug. When set, approval "
                    "of this reward will credit one of this item to the "
                    "user's inventory.",
    )


class UpdateRewardIn(_Base):
    reward_id: int
    name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    description: Optional[str] = None
    icon: Optional[str] = None
    cost_coins: Optional[int] = Field(default=None, ge=0)
    rarity: Optional[BadgeRarity] = None
    stock: Optional[int] = Field(default=None, ge=0)
    clear_stock: bool = Field(
        default=False,
        description="Set true to set stock to None (unlimited). Overrides "
                    "the stock field.",
    )
    requires_parent_approval: Optional[bool] = None
    is_active: Optional[bool] = None
    order: Optional[int] = None
    fulfillment_kind: Optional[RewardFulfillmentKind] = None
    item_definition_slug: Optional[str] = None
    clear_item_definition: bool = False


class DeleteRewardIn(_Base):
    reward_id: int


class AdjustCoinsIn(_Base):
    user_id: int
    amount: int = Field(
        description="Positive to grant coins, negative to revoke.",
    )
    description: str = Field(min_length=1, max_length=200)


# ---------------------------------------------------------------------------
# Payments
# ---------------------------------------------------------------------------


PaymentEntryType = Literal[
    "hourly", "project_bonus", "bounty_payout", "milestone_bonus",
    "materials_reimbursement", "payout", "adjustment",
]


class GetPaymentBalanceIn(_Base):
    user_id: Optional[int] = None


class ListPaymentLedgerIn(_Base):
    user_id: Optional[int] = None
    entry_type: Optional[PaymentEntryType] = None
    since: Optional[date] = None
    limit: int = Field(default=50, ge=1, le=500)


class RecordPayoutIn(_Base):
    user_id: int
    amount: Decimal = Field(gt=Decimal("0"))
    description: str = ""


class AdjustPaymentIn(_Base):
    user_id: int
    amount: Decimal
    description: str


# ---------------------------------------------------------------------------
# Timecards
# ---------------------------------------------------------------------------


TimeEntryStatus = Literal["active", "completed", "voided"]
TimecardStatus = Literal["pending", "approved", "paid", "disputed"]


class ListTimeEntriesIn(_Base):
    user_id: Optional[int] = None
    status: Optional[TimeEntryStatus] = None
    since: Optional[date] = None
    limit: int = Field(default=100, ge=1, le=500)


class GetActiveEntryIn(_Base):
    user_id: Optional[int] = None


class ListTimecardsIn(_Base):
    user_id: Optional[int] = None
    status: Optional[TimecardStatus] = None
    limit: int = Field(default=20, ge=1, le=100)


class ApproveTimecardIn(_Base):
    timecard_id: int
    notes: str = ""


# ---------------------------------------------------------------------------
# Achievements
# ---------------------------------------------------------------------------


BadgeRarity = Literal["common", "uncommon", "rare", "epic", "legendary"]


class ListSkillCategoriesIn(_Base):
    pass


class ListSkillsIn(_Base):
    category_id: Optional[int] = None
    subject_id: Optional[int] = None
    q: Optional[str] = None
    limit: int = Field(default=200, ge=1, le=500)


class GetSkillTreeIn(_Base):
    category_id: int
    user_id: Optional[int] = None


class ListBadgesIn(_Base):
    rarity: Optional[BadgeRarity] = None


class ListEarnedBadgesIn(_Base):
    user_id: Optional[int] = None


# --- Tier 2.1: Skill tree taxonomy ---------------------------------------


BadgeCriteriaType = Literal[
    "projects_completed",
    "hours_worked",
    "category_projects",
    "streak_days",
    "first_project",
    "first_clock_in",
    "materials_under_budget",
    "perfect_timecard",
    "skill_level_reached",
    "skills_unlocked",
    "skill_categories_breadth",
    "subjects_completed",
    "hours_in_day",
    "photos_uploaded",
    "total_earned",
    "days_worked",
    "cross_category_unlock",
]


class CreateCategoryIn(_Base):
    name: str = Field(min_length=1, max_length=100)
    icon: str = ""
    color: str = Field(default="#D97706", pattern=r"^#[0-9A-Fa-f]{6}$")
    description: str = ""


class UpdateCategoryIn(_Base):
    category_id: int
    name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    icon: Optional[str] = None
    color: Optional[str] = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")
    description: Optional[str] = None


class DeleteCategoryIn(_Base):
    category_id: int


class CreateSubjectIn(_Base):
    category_id: int
    name: str = Field(min_length=1, max_length=100)
    description: str = ""
    icon: str = ""
    order: int = 0


class UpdateSubjectIn(_Base):
    subject_id: int
    category_id: Optional[int] = None
    name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    description: Optional[str] = None
    icon: Optional[str] = None
    order: Optional[int] = None


class DeleteSubjectIn(_Base):
    subject_id: int


class SkillPrereqDraft(_Base):
    required_skill_id: int
    required_level: int = Field(default=2, ge=1, le=6)


class CreateSkillIn(_Base):
    category_id: int
    subject_id: Optional[int] = None
    name: str = Field(min_length=1, max_length=100)
    description: str = ""
    icon: str = ""
    level_names: dict = Field(default_factory=dict)
    is_locked_by_default: bool = False
    order: int = 0
    prerequisites: list[SkillPrereqDraft] = Field(default_factory=list)


class UpdateSkillIn(_Base):
    skill_id: int
    category_id: Optional[int] = None
    subject_id: Optional[int] = None
    name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    description: Optional[str] = None
    icon: Optional[str] = None
    level_names: Optional[dict] = None
    is_locked_by_default: Optional[bool] = None
    order: Optional[int] = None
    clear_subject: bool = False


class DeleteSkillIn(_Base):
    skill_id: int


class AddSkillPrerequisiteIn(_Base):
    skill_id: int
    required_skill_id: int
    required_level: int = Field(default=2, ge=1, le=6)


class RemoveSkillPrerequisiteIn(_Base):
    skill_id: int
    required_skill_id: int


class CreateBadgeIn(_Base):
    name: str = Field(min_length=1, max_length=100)
    description: str
    icon: str = ""
    subject_id: Optional[int] = None
    criteria_type: BadgeCriteriaType
    criteria_value: dict = Field(default_factory=dict)
    xp_bonus: int = Field(default=0, ge=0)
    rarity: BadgeRarity = "common"


class UpdateBadgeIn(_Base):
    badge_id: int
    name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    description: Optional[str] = None
    icon: Optional[str] = None
    subject_id: Optional[int] = None
    clear_subject: bool = False
    criteria_type: Optional[BadgeCriteriaType] = None
    criteria_value: Optional[dict] = None
    xp_bonus: Optional[int] = Field(default=None, ge=0)
    rarity: Optional[BadgeRarity] = None


class DeleteBadgeIn(_Base):
    badge_id: int


# --- Tier 2.2: Quests -----------------------------------------------------


QuestType = Literal["boss", "collection"]


class ListQuestsIn(_Base):
    user_id: Optional[int] = None
    include_completed: bool = False
    limit: int = Field(default=20, ge=1, le=100)


class GetQuestIn(_Base):
    quest_id: int


class ListQuestCatalogIn(_Base):
    quest_type: Optional[QuestType] = None


class CreateQuestDefinitionIn(_Base):
    name: str = Field(min_length=1, max_length=100)
    description: str
    icon: str = "⚔️"
    quest_type: QuestType
    target_value: int = Field(ge=1)
    duration_days: int = Field(default=7, ge=1, le=365)
    trigger_filter: dict = Field(default_factory=dict)
    coin_reward: int = Field(default=0, ge=0)
    xp_reward: int = Field(default=0, ge=0)
    is_repeatable: bool = False
    required_badge_id: Optional[int] = None
    assigned_to_id: Optional[int] = Field(
        default=None,
        description="If set, also auto-start a live Quest for this child.",
    )


class AssignQuestIn(_Base):
    definition_id: int
    user_id: int


class AssignCoOpQuestIn(_Base):
    """Parent starts ONE shared Quest across multiple children.

    Creates a single ``Quest`` row with one ``QuestParticipant`` per
    user_id. All participants contribute to the same target_value pool,
    and rewards go to every participant on completion. Fails atomically
    if any participant is already on an active quest.
    """

    definition_id: int
    user_ids: list[int] = Field(min_length=2, max_length=10)


class CancelQuestIn(_Base):
    quest_id: int


class DeleteQuestDefinitionIn(_Base):
    """Permanently remove a QuestDefinition.

    Parent-only. Cascades to any ``Quest`` instances (including their
    ``QuestParticipant`` + progress rows) — use with care. Typically used
    for cleaning up dev/smoke-test rows that have ``is_system=False`` and
    no user-facing value.
    """

    quest_definition_id: int


# --- Tier 2.3: Habits -----------------------------------------------------


HabitType = Literal["positive", "negative", "both"]


class ListHabitsIn(_Base):
    user_id: Optional[int] = None
    limit: int = Field(default=50, ge=1, le=200)


class GetHabitIn(_Base):
    habit_id: int


class CreateHabitIn(_Base):
    name: str = Field(min_length=1, max_length=100)
    icon: str = ""
    habit_type: HabitType = "positive"
    xp_reward: int = Field(default=5, ge=0)
    max_taps_per_day: int = Field(
        default=1,
        ge=1,
        le=50,
        description="Per-day cap on positive taps. Negative taps stay uncapped.",
    )
    user_id: Optional[int] = Field(
        default=None,
        description="Parent-only: assign to a specific child. Omit to assign "
                    "to self.",
    )


class UpdateHabitIn(_Base):
    habit_id: int
    name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    icon: Optional[str] = None
    habit_type: Optional[HabitType] = None
    xp_reward: Optional[int] = Field(default=None, ge=0)
    max_taps_per_day: Optional[int] = Field(default=None, ge=1, le=50)
    is_active: Optional[bool] = None


class DeleteHabitIn(_Base):
    habit_id: int


class LogHabitIn(_Base):
    habit_id: int
    amount: int = Field(
        default=1,
        description="+1 for positive tap, -1 for negative tap. Rejected if "
                    "the habit type doesn't allow the sign.",
    )


# --- Tier 3.1: Children & collaborators -----------------------------------


ChildTheme = Literal["default", "abby", "otto"]


class UpdateChildIn(_Base):
    user_id: int
    hourly_rate: Optional[Decimal] = Field(default=None, ge=Decimal("0"))
    display_name: Optional[str] = Field(default=None, max_length=100)
    theme: Optional[ChildTheme] = None


class AddCollaboratorIn(_Base):
    project_id: int
    user_id: int
    pay_split_percent: int = Field(default=50, ge=0, le=100)


class RemoveCollaboratorIn(_Base):
    project_id: int
    user_id: int


# --- Tier 3.2: Savings goal update/delete ---------------------------------


class UpdateSavingsGoalIn(_Base):
    goal_id: int
    title: Optional[str] = Field(default=None, min_length=1, max_length=200)
    target_amount: Optional[Decimal] = Field(default=None, gt=Decimal("0"))
    icon: Optional[str] = None


class DeleteSavingsGoalIn(_Base):
    goal_id: int


# --- Tier 3.3: Portfolio enrichment ---------------------------------------


class ListPortfolioMediaIn(_Base):
    user_id: Optional[int] = None
    limit: int = Field(default=50, ge=1, le=200)


# ---------------------------------------------------------------------------
# Ingestion
# ---------------------------------------------------------------------------


IngestionSourceType = Literal["instructables", "url", "pdf"]


class SubmitIngestionJobIn(_Base):
    source_type: IngestionSourceType
    source_url: str


class GetIngestionJobIn(_Base):
    job_id: str


class ListIngestionJobsIn(_Base):
    status: Optional[str] = None
    limit: int = Field(default=20, ge=1, le=100)


class CommitIngestionJobIn(_Base):
    job_id: str
    title: Optional[str] = None
    description: Optional[str] = None
    assigned_to_id: Optional[int] = None
    category_id: Optional[int] = None
    difficulty: Optional[int] = None
    bonus_amount: Optional[Decimal] = None
    materials_budget: Optional[Decimal] = None
    due_date: Optional[date] = None


# ---------------------------------------------------------------------------
# Savings
# ---------------------------------------------------------------------------


class ListSavingsGoalsIn(_Base):
    user_id: Optional[int] = None
    include_completed: bool = False


class CreateSavingsGoalIn(_Base):
    title: str = Field(min_length=1, max_length=200)
    target_amount: Decimal = Field(gt=Decimal("0"))
    icon: str = ""


# ---------------------------------------------------------------------------
# Portfolio
# ---------------------------------------------------------------------------


class ListProjectPhotosIn(_Base):
    project_id: int


class GetPortfolioSummaryIn(_Base):
    user_id: Optional[int] = None


# ---------------------------------------------------------------------------
# Users
# ---------------------------------------------------------------------------


class ListChildrenIn(_Base):
    pass


class GetUserIn(_Base):
    user_id: Optional[int] = None


# ---------------------------------------------------------------------------
# Notifications
# ---------------------------------------------------------------------------


class ListNotificationsIn(_Base):
    unread_only: bool = False
    limit: int = Field(default=50, ge=1, le=200)


class MarkNotificationReadIn(_Base):
    notification_id: int


# ---------------------------------------------------------------------------
# Chores
# ---------------------------------------------------------------------------


ChoreRecurrence = Literal["daily", "weekly", "one_time"]
ChoreWeekSchedule = Literal["every_week", "alternating"]
ChoreCompletionStatus = Literal["pending", "approved", "rejected"]


class ListChoresIn(_Base):
    assigned_to_id: Optional[int] = None
    limit: int = Field(default=50, ge=1, le=200)


class GetChoreIn(_Base):
    chore_id: int


class CreateChoreIn(_Base):
    title: str = Field(min_length=1, max_length=200)
    description: str = ""
    icon: str = ""
    reward_amount: Decimal = Field(default=Decimal("0.00"), ge=Decimal("0"))
    coin_reward: int = Field(default=0, ge=0)
    recurrence: ChoreRecurrence = "daily"
    week_schedule: ChoreWeekSchedule = "every_week"
    schedule_start_date: Optional[date] = None
    assigned_to_id: Optional[int] = None
    is_active: bool = True
    order: int = 0


class UpdateChoreIn(_Base):
    chore_id: int
    title: Optional[str] = None
    description: Optional[str] = None
    icon: Optional[str] = None
    reward_amount: Optional[Decimal] = None
    coin_reward: Optional[int] = None
    recurrence: Optional[ChoreRecurrence] = None
    week_schedule: Optional[ChoreWeekSchedule] = None
    schedule_start_date: Optional[date] = None
    assigned_to_id: Optional[int] = None
    is_active: Optional[bool] = None
    order: Optional[int] = None


class CompleteChoreIn(_Base):
    chore_id: int
    notes: str = ""


class ListChoreCompletionsIn(_Base):
    user_id: Optional[int] = None
    status: Optional[ChoreCompletionStatus] = None
    limit: int = Field(default=50, ge=1, le=200)


class DecideChoreCompletionIn(_Base):
    completion_id: int


# ---------------------------------------------------------------------------
# Homework
# ---------------------------------------------------------------------------

HomeworkSubject = Literal[
    "math", "reading", "writing", "science", "social_studies", "art", "music", "other",
]
HomeworkSubmissionStatus = Literal["pending", "approved", "rejected"]


class ListHomeworkIn(_Base):
    assigned_to_id: Optional[int] = None
    subject: Optional[HomeworkSubject] = None
    limit: int = Field(default=50, ge=1, le=200)


class GetHomeworkIn(_Base):
    assignment_id: int


class CreateHomeworkIn(_Base):
    title: str = Field(min_length=1, max_length=255)
    description: str = ""
    subject: HomeworkSubject = "other"
    effort_level: int = Field(default=3, ge=1, le=5)
    due_date: date
    assigned_to_id: int
    notes: str = ""
    skill_tags: list[dict] = Field(
        default_factory=list,
        description='[{"skill_id": 1, "xp_amount": 15}, ...]',
    )


class SubmitHomeworkIn(_Base):
    assignment_id: int
    notes: str = ""


class ListHomeworkSubmissionsIn(_Base):
    user_id: Optional[int] = None
    status: Optional[HomeworkSubmissionStatus] = None
    limit: int = Field(default=50, ge=1, le=200)


class DecideHomeworkSubmissionIn(_Base):
    submission_id: int


class PlanHomeworkIn(_Base):
    assignment_id: int


# --- Tier 1.4: Homework update/delete/templates ---------------------------


class HomeworkSkillTagDraft(_Base):
    skill_id: int
    xp_amount: int = Field(default=15, ge=0)


class WeightedSkillTagDraft(_Base):
    """Parallel to HomeworkSkillTagDraft but for weighted-pool entities.

    Chore / Habit / Quest distribute a single XP pool across tags by
    weight ratio (ProjectSkillTag pattern), unlike Homework which
    awards xp_amount per tag directly.
    """

    skill_id: int
    xp_weight: int = Field(default=1, ge=0)


class SetChoreSkillTagsIn(_Base):
    chore_id: int
    skill_tags: list[WeightedSkillTagDraft]


class SetHabitSkillTagsIn(_Base):
    habit_id: int
    skill_tags: list[WeightedSkillTagDraft]


class SetQuestDefinitionSkillTagsIn(_Base):
    quest_definition_id: int
    skill_tags: list[WeightedSkillTagDraft]


class UpdateHomeworkIn(_Base):
    assignment_id: int
    title: Optional[str] = Field(default=None, min_length=1, max_length=255)
    description: Optional[str] = None
    subject: Optional[HomeworkSubject] = None
    effort_level: Optional[int] = Field(default=None, ge=1, le=5)
    due_date: Optional[date] = None
    notes: Optional[str] = None


class DeleteHomeworkIn(_Base):
    assignment_id: int


class SetHomeworkSkillTagsIn(_Base):
    assignment_id: int
    skill_tags: list[HomeworkSkillTagDraft]


class ListHomeworkTemplatesIn(_Base):
    limit: int = Field(default=50, ge=1, le=200)


class GetHomeworkTemplateIn(_Base):
    template_id: int


class CreateHomeworkTemplateIn(_Base):
    title: str = Field(min_length=1, max_length=255)
    description: str = ""
    subject: HomeworkSubject = "other"
    effort_level: int = Field(default=3, ge=1, le=5)
    skill_tags: list[HomeworkSkillTagDraft] = Field(default_factory=list)


class UpdateHomeworkTemplateIn(_Base):
    template_id: int
    title: Optional[str] = Field(default=None, min_length=1, max_length=255)
    description: Optional[str] = None
    subject: Optional[HomeworkSubject] = None
    effort_level: Optional[int] = Field(default=None, ge=1, le=5)
    skill_tags: Optional[list[HomeworkSkillTagDraft]] = None


class DeleteHomeworkTemplateIn(_Base):
    template_id: int


class CreateHomeworkFromTemplateIn(_Base):
    template_id: int
    assigned_to_id: int
    due_date: date


# ---------------------------------------------------------------------------
# Dashboard
# ---------------------------------------------------------------------------


class GetDashboardIn(_Base):
    user_id: Optional[int] = None


# ---------------------------------------------------------------------------
# Content Packs (RPG YAML authoring)
# ---------------------------------------------------------------------------
#
# Packs live under ``content/rpg/packs/<name>/`` and are loaded with the
# existing ``loadrpgcontent`` pipeline using ``namespace=<name>-``. The LLM
# authors YAML files in a pack, validates with a dry-run, then commits.
# Writes to ``content/rpg/initial/`` are blocked unconditionally.


PackFilename = Literal[
    "items.yaml",
    "drops.yaml",
    "quests.yaml",
    "badges.yaml",
    "pet_species.yaml",
    "potion_types.yaml",
    "skill_tree.yaml",
    "rewards.yaml",
]


class ListContentPacksIn(_Base):
    pass


class GetContentPackIn(_Base):
    pack: str = Field(min_length=1, max_length=40)


class ReadPackFileIn(_Base):
    pack: str = Field(min_length=1, max_length=40)
    filename: PackFilename


class WritePackFileIn(_Base):
    pack: str = Field(min_length=1, max_length=40)
    filename: PackFilename
    yaml_content: str = Field(max_length=200_000)


class DeletePackFileIn(_Base):
    pack: str = Field(min_length=1, max_length=40)
    filename: PackFilename


class DeleteContentPackIn(_Base):
    pack: str = Field(min_length=1, max_length=40)
    confirm: bool = Field(
        default=False,
        description="Must be true to actually delete the pack directory.",
    )


class ValidateContentPackIn(_Base):
    pack: str = Field(min_length=1, max_length=40)


class LoadContentPackIn(_Base):
    pack: str = Field(min_length=1, max_length=40)
    dry_run: bool = False


class PrunePackContentIn(_Base):
    pack: str = Field(min_length=1, max_length=40)
    dry_run: bool = Field(
        default=False,
        description="Report counts without deleting anything.",
    )


class ListRpgCatalogIn(_Base):
    """Filters for the RPG catalog read tool.

    Empty = return everything. Use ``item_type`` to narrow items, and
    ``trigger_type`` to narrow drop-table entries to one trigger.
    """
    item_type: Optional[str] = None
    trigger_type: Optional[str] = None
    limit_per_section: int = Field(default=200, ge=1, le=1000)


# ---------------------------------------------------------------------------
# Draft pack entries (merge-write helper over write_pack_file)
# ---------------------------------------------------------------------------


DraftPackFilename = Literal[
    "items.yaml",
    "pet_species.yaml",
    "potion_types.yaml",
    "badges.yaml",
    "quests.yaml",
    "rewards.yaml",
]


class DraftPackEntriesIn(_Base):
    """Merge a list of YAML entries into an existing pack file.

    For files whose top-level key is a list of rows (items, pet_species,
    potion_types, badges, quests, rewards), this tool parses the existing
    file, appends or replaces, dedupes by natural key, and writes the
    result back. Saves the LLM from hand-merging YAML.
    """
    pack: str = Field(min_length=1, max_length=40)
    filename: DraftPackFilename
    entries: list[dict] = Field(
        min_length=1,
        description="Ready-to-serialize entries matching the loader's schema.",
    )
    mode: Literal["append", "replace"] = "append"


# ---------------------------------------------------------------------------
# Sprite asset ingestion
# ---------------------------------------------------------------------------


_SPRITE_ID_PATTERN = r"^[a-z0-9][a-z0-9-]*$"


class SheetDecl(_Base):
    """Declaration of a spritesheet to register in the shared manifest."""
    id: str = Field(
        min_length=1, max_length=64, pattern=_SPRITE_ID_PATTERN,
        description="Logical id (lowercase, hyphens, digits).",
    )
    file: str = Field(
        min_length=1, max_length=500,
        description=(
            "Repo-relative path to the sheet PNG. Must live under "
            "``reward-icons/<pack>/`` or the pack's own ``sprites/`` dir."
        ),
    )
    tile_size: int = Field(gt=0, le=512)


class SpriteTileDecl(_Base):
    """Declaration of a sheet-tile sprite."""
    slug: str = Field(
        min_length=1, max_length=64, pattern=_SPRITE_ID_PATTERN,
    )
    sheet: str = Field(
        min_length=1, max_length=64, pattern=_SPRITE_ID_PATTERN,
        description="Must match the ``id`` of a sheet being registered or "
                    "already present in the manifest.",
    )
    col: int = Field(ge=0, le=1024)
    row: int = Field(ge=0, le=1024)


class SpriteLooseDecl(_Base):
    """Declaration of a loose-file sprite (standalone PNG, copied as-is)."""
    slug: str = Field(
        min_length=1, max_length=64, pattern=_SPRITE_ID_PATTERN,
    )
    file: str = Field(
        min_length=1, max_length=500,
        description=(
            "Repo-relative path to the PNG. Must live under the pack's own "
            "``content/rpg/packs/<pack>/sprites/`` dir."
        ),
    )


class RegisterSpriteAssetsIn(_Base):
    """Register sprite artwork for a content pack.

    Idempotent: re-registering the same slug updates the manifest entry
    and (if ``force=True``) re-slices the output PNG. Slugs listed here
    become available as ``sprite_key`` values in the pack's YAML files.
    """
    pack: str = Field(min_length=1, max_length=40)
    sheets: list[SheetDecl] = Field(
        default_factory=list,
        description="Spritesheets to register. Can be empty if every sprite "
                    "below is a loose file or references a sheet already in "
                    "the manifest.",
    )
    tiles: list[SpriteTileDecl] = Field(
        default_factory=list,
        description="Sheet-tile sprites to register.",
    )
    loose: list[SpriteLooseDecl] = Field(
        default_factory=list,
        description="Loose-file sprites to register.",
    )
    force: bool = Field(
        default=False,
        description="Re-slice and overwrite any existing output PNGs.",
    )


# ---------------------------------------------------------------------------
# Sprite authoring (chat-to-prod runtime sprites)
# ---------------------------------------------------------------------------

FrameLayout = Literal["horizontal", "vertical"]
SPRITE_SLUG_PATTERN = r"^[a-z0-9][a-z0-9-]*$"


class RegisterSpriteIn(_Base):
    slug: str = Field(min_length=1, max_length=64, pattern=SPRITE_SLUG_PATTERN)
    image_b64: Optional[str] = Field(
        default=None,
        description="Base64-encoded PNG or WebP bytes. Exactly one of image_b64/image_url required.",
    )
    image_url: Optional[str] = Field(
        default=None,
        description="https URL to PNG/WebP. Exactly one of image_b64/image_url required.",
    )
    pack: str = Field(default="user-authored", max_length=40)
    frame_count: int = Field(default=1, ge=1, le=64)
    fps: int = Field(default=0, ge=0, le=30)
    frame_layout: FrameLayout = "horizontal"
    overwrite: bool = False


class AnimatedSpriteTileDecl(_Base):
    slug: str = Field(min_length=1, max_length=64, pattern=SPRITE_SLUG_PATTERN)
    col: int = Field(ge=0, le=1024)
    row: int = Field(ge=0, le=1024)
    frame_count: int = Field(default=1, ge=1, le=64)
    fps: int = Field(default=0, ge=0, le=30)
    pack: str = Field(default="user-authored", max_length=40)


class RegisterSpriteBatchIn(_Base):
    sheet_b64: Optional[str] = None
    sheet_url: Optional[str] = None
    tile_size: int = Field(ge=8, le=256)
    tiles: list[AnimatedSpriteTileDecl] = Field(min_length=1, max_length=200)
    overwrite: bool = False


class ListSpritesIn(_Base):
    pack: Optional[str] = None
    limit: int = Field(default=200, ge=1, le=500)


class GetSpriteIn(_Base):
    """Fetch the full authoring shape for one sprite (parent-only).

    ``list_sprites`` deliberately stays lean (slug + url + structural
    metadata only). This tool returns the additional authoring inputs
    (``prompt``, ``original_intent``, ``motion``, ``style_hint``,
    ``tile_size``, ``reference_image_url``) so a chat-side meta-prompt
    loop can read what was sent to Gemini and critique it against the
    rendered image at ``url``.
    """

    slug: str = Field(min_length=1, max_length=64, pattern=SPRITE_SLUG_PATTERN)
    include_image: bool = Field(
        default=False,
        description=(
            "Also return the rendered sprite as an inline MCP ``ImageContent`` "
            "block (base64 PNG) so it lands in the chat agent's context "
            "window directly — no separate HTTP fetch against the public "
            "Ceph URL required. Capped at ~200 KB raw "
            "(frame_count × frame_width_px × frame_height_px × 4); sprites "
            "above the cap raise ``MCPValidationError`` and the caller falls "
            "back to ``url`` for an HTTP fetch."
        ),
    )


class DeleteSpriteIn(_Base):
    slug: str = Field(min_length=1, max_length=64, pattern=SPRITE_SLUG_PATTERN)


class UpdateSpriteMetadataIn(_Base):
    """Update metadata fields on an existing sprite WITHOUT regenerating
    the image. Useful for fps tuning (adjusting animation speed on
    already-good sprites) and pack reassignment (curation passes).
    Dimensions and frame_count are NOT exposed because they're tied
    to the underlying image content — changing them decoupled from
    the image risks silent corruption of the rendering contract."""

    slug: str = Field(min_length=1, max_length=64, pattern=SPRITE_SLUG_PATTERN)
    fps: Optional[int] = Field(default=None, ge=0, le=30)
    pack: Optional[str] = Field(default=None, max_length=40)

    @model_validator(mode="after")
    def _require_at_least_one_update(self) -> "UpdateSpriteMetadataIn":
        if self.fps is None and self.pack is None:
            raise ValueError(
                "at least one of fps / pack must be provided — a no-op "
                "update would silently succeed with no effect",
            )
        return self


SPRITE_TILE_SIZES = (32, 64, 128)
SpriteMotion = Literal[
    "idle", "walk", "bounce",
    "bubble", "flicker", "glow", "wobble", "sway",
]


class GenerateSpriteSheetIn(_Base):
    """Input to the ``generate_sprite_sheet`` MCP tool.

    Frame-count / fps cross-validation mirrors ``SpriteAsset.clean()`` so
    invalid combinations fail fast at pydantic construction, before the
    tool ever runs and before the Gemini SDK is loaded.

    ``motion`` selects which 4-phase cyclic template drives per-frame
    poses (see ``sprite_generation.MOTION_TEMPLATES``) — silently
    ignored when ``frame_count == 1``. Default is ``"idle"`` because
    (a) it's the most common pose on a tile-grid RPG map and (b) small
    per-frame deltas make it the most forgiving for Gemini.
    """

    slug: str = Field(min_length=1, max_length=64, pattern=SPRITE_SLUG_PATTERN)
    prompt: str = Field(min_length=3, max_length=500)
    frame_count: int = Field(default=1, ge=1, le=8)
    tile_size: int = Field(default=128)
    fps: int = Field(default=0, ge=0, le=30)
    pack: str = Field(default="ai-generated", max_length=40)
    style_hint: str = Field(default="", max_length=200)
    motion: SpriteMotion = "idle"
    # Optional style + character anchor. When provided, the service
    # downloads this URL and passes the bytes to Gemini alongside the
    # text prompt. The generated sprite must match the reference
    # image's character design, palette, and style — enables the
    # self-anchored bulk-animation workflow (animate an existing
    # static sprite by passing its own URL here).
    reference_image_url: Optional[str] = Field(default=None, max_length=500)
    # Optional plain-English description of what the parent originally
    # asked for. Persisted on ``SpriteAsset.original_intent`` alongside
    # the refined ``prompt`` so a future reroll can re-refine from the
    # same starting intent (different Claude output each time) instead
    # of just replaying the stored prompt verbatim. Empty string by
    # default — refined prompts authored directly via this tool don't
    # need to fill it in.
    original_intent: str = Field(default="", max_length=1000)
    # Debug-only: when True, also save the raw Gemini output and the
    # post-chroma-key output to the sprites bucket under a debug/
    # prefix, and include their URLs in the response. Useful for
    # diagnosing pipeline issues — inspect what Gemini actually
    # produced before our post-processing touched it.
    return_debug_raw: bool = False
    overwrite: bool = False

    @field_validator("tile_size")
    @classmethod
    def _tile_size_in_scale(cls, v: int) -> int:
        if v not in SPRITE_TILE_SIZES:
            raise ValueError(f"tile_size must be one of {SPRITE_TILE_SIZES}")
        return v

    @model_validator(mode="after")
    def _frames_and_fps(self) -> "GenerateSpriteSheetIn":
        if self.frame_count == 1 and self.fps != 0:
            raise ValueError("static sprites (frame_count == 1) require fps == 0")
        if self.frame_count > 1 and self.fps < 1:
            raise ValueError("animated sprites (frame_count > 1) require fps >= 1")
        return self


class RerollSpriteIn(_Base):
    """Re-run ``generate_sprite_sheet`` with the inputs stored on the existing
    ``SpriteAsset`` row. Mirrors ``POST /api/sprites/admin/<slug>/reroll/``.

    Optional override fields layer on top of the stored row, supporting the
    chat-side critique loop: Claude critiques a rendered sprite, calls
    ``propose_sprite_reroll`` to get a refined prompt, then calls THIS tool
    with the refined inputs. The generation service writes whatever inputs
    it ran with back onto the SpriteAsset row at the end of the pipeline,
    so a subsequent reroll resumes from the refined state without any
    additional plumbing.

    Fails when the sprite's stored ``prompt`` is empty (e.g. legacy
    ``register_sprite`` uploads). The caller should re-author with
    ``generate_sprite_sheet`` directly in that case.
    """

    slug: str = Field(min_length=1, max_length=64, pattern=SPRITE_SLUG_PATTERN)
    return_debug_raw: bool = False
    prompt: Optional[str] = Field(
        default=None,
        min_length=3,
        max_length=500,
        description="Override the stored prompt for this reroll.",
    )
    motion: Optional[SpriteMotion] = Field(
        default=None,
        description="Override the stored motion for this reroll.",
    )
    style_hint: Optional[str] = Field(
        default=None,
        max_length=200,
        description="Override the stored style hint for this reroll.",
    )
    tile_size: Optional[int] = Field(
        default=None,
        description="Override the stored tile_size for this reroll.",
    )

    @field_validator("tile_size")
    @classmethod
    def _tile_size_in_scale_optional(cls, v: Optional[int]) -> Optional[int]:
        if v is not None and v not in SPRITE_TILE_SIZES:
            raise ValueError(f"tile_size must be one of {SPRITE_TILE_SIZES}")
        return v


class ProposeSpriteRerollIn(_Base):
    """Inputs to the ``propose_sprite_reroll`` MCP tool.

    Pure prompt construction — does NOT call Gemini. The chat agent feeds
    its vision-based critique of an existing sprite (free-form English),
    and the tool returns a refined ``generate_sprite_sheet`` prompt plus
    proposed overrides for ``motion`` / ``style_hint`` / ``tile_size``.
    The chat then passes those into ``reroll_sprite``.
    """

    slug: str = Field(min_length=1, max_length=64, pattern=SPRITE_SLUG_PATTERN)
    critique: str = Field(
        min_length=3,
        max_length=2000,
        description="Free-form description of what's wrong with the current "
                    "sprite. Keywords like 'too small', 'wrong pose', 'wrong "
                    "colors', 'edges cut off', 'too much empty space' map to "
                    "specific refinement rules.",
    )
    target_changes: list[str] = Field(
        default_factory=list,
        max_length=10,
        description="Optional explicit refinement levers — overrides keyword "
                    "detection. Accepted values: 'larger_subject', "
                    "'switch_motion', 'strengthen_style', 'drop_reference', "
                    "'bigger_tile'.",
    )


class GetSpritePromptingPlaybookIn(_Base):
    """No payload — the playbook is a single static document. Empty schema
    keeps the MCP tool callable without requiring any parameters."""


# ---------------------------------------------------------------------------
# Movement sessions
# ---------------------------------------------------------------------------


MovementIntensity = Literal["low", "medium", "high"]


class ListMovementTypesIn(_Base):
    active_only: bool = True


class ListMovementSessionsIn(_Base):
    user_id: Optional[int] = None
    since: Optional[date] = None
    limit: int = Field(default=50, ge=1, le=200)


class GetMovementSessionIn(_Base):
    session_id: int


class LogMovementSessionIn(_Base):
    movement_type_id: int
    duration_minutes: int = Field(ge=1, le=600)
    intensity: MovementIntensity = "medium"
    notes: str = Field(default="", max_length=200)
    user_id: Optional[int] = Field(
        default=None,
        description="Parent-only: log a session on a child's behalf. Children "
                    "can only log for themselves.",
    )


class DeleteMovementSessionIn(_Base):
    session_id: int


class SetMovementTypeSkillTagsIn(_Base):
    movement_type_id: int
    skill_tags: list["WeightedSkillTagDraft"]


# ---------------------------------------------------------------------------
# Creations
# ---------------------------------------------------------------------------


CreationStatus = Literal["logged", "pending", "approved", "rejected"]


class ListCreationsIn(_Base):
    user_id: Optional[int] = None
    status: Optional[CreationStatus] = None
    limit: int = Field(default=50, ge=1, le=200)


class GetCreationIn(_Base):
    creation_id: int


class LogCreationIn(_Base):
    """Log a child-authored Creation.

    ``image_b64`` carries the photo bytes (PNG/JPEG/WebP). The MCP entry
    point doesn't accept multipart, so the caller embeds bytes directly —
    the same shape used by ``register_sprite``. ``audio_b64`` is optional.
    """

    image_b64: str = Field(
        min_length=1,
        description="Base64-encoded PNG/JPEG/WebP image bytes.",
    )
    primary_skill_id: int
    secondary_skill_id: Optional[int] = None
    audio_b64: Optional[str] = Field(
        default=None,
        description="Optional base64-encoded audio bytes (M4A/MP3/WAV).",
    )
    caption: str = Field(default="", max_length=200)
    user_id: Optional[int] = Field(
        default=None,
        description="Parent-only: log a Creation on a child's behalf.",
    )


class DeleteCreationIn(_Base):
    creation_id: int


class SubmitCreationIn(_Base):
    creation_id: int


class CreationSkillTagDraft(_Base):
    skill_id: int
    xp_weight: int = Field(default=1, ge=1)


class ApproveCreationIn(_Base):
    creation_id: int
    bonus_xp: int = Field(
        default=15, ge=0, le=100,
        description="Parent-granted bonus XP pool. Default 15.",
    )
    skill_tags: list[CreationSkillTagDraft] = Field(
        default_factory=list,
        description="Optional parent-authored skill fan-out for the bonus pool. "
                    "Empty = fall back to the child's primary skill.",
    )
    notes: str = Field(default="", max_length=500)


class RejectCreationIn(_Base):
    creation_id: int
    notes: str = Field(default="", max_length=500)


class ListPendingCreationsIn(_Base):
    limit: int = Field(default=50, ge=1, le=200)


# ---------------------------------------------------------------------------
# Pets / Mounts / Breeding
# ---------------------------------------------------------------------------


class ListPetsIn(_Base):
    user_id: Optional[int] = None


class GetPetStableIn(_Base):
    user_id: Optional[int] = None


class HatchPetIn(_Base):
    egg_item_id: int
    potion_item_id: int
    user_id: Optional[int] = Field(
        default=None,
        description="Parent-only: hatch on behalf of a child.",
    )


class FeedPetIn(_Base):
    pet_id: int
    food_item_id: int
    user_id: Optional[int] = Field(default=None)


class ActivatePetIn(_Base):
    pet_id: int
    user_id: Optional[int] = Field(default=None)


class ListMountsIn(_Base):
    user_id: Optional[int] = None


class ActivateMountIn(_Base):
    mount_id: int
    user_id: Optional[int] = Field(default=None)


class BreedMountsIn(_Base):
    mount_a_id: int
    mount_b_id: int
    user_id: Optional[int] = Field(default=None)


# ---------------------------------------------------------------------------
# Money ↔ Coins exchange
# ---------------------------------------------------------------------------


ExchangeStatus = Literal["pending", "approved", "denied"]


class GetExchangeRateIn(_Base):
    pass


class ListExchangeRequestsIn(_Base):
    user_id: Optional[int] = None
    status: Optional[ExchangeStatus] = None
    limit: int = Field(default=50, ge=1, le=200)


class RequestExchangeIn(_Base):
    dollar_amount: Decimal = Field(
        ge=Decimal("1.00"),
        description="Minimum $1.00. Rate (COINS_PER_DOLLAR) is snapshotted on "
                    "the request and applied at approval time.",
    )


class DecideExchangeIn(_Base):
    exchange_id: int
    notes: str = Field(default="", max_length=500)


# ---------------------------------------------------------------------------
# Chronicle / Journal
# ---------------------------------------------------------------------------


ChronicleKind = Literal[
    "birthday", "chapter_start", "chapter_end", "first_ever",
    "milestone", "recap", "manual", "journal", "creation", "grade",
]


class ListChronicleEntriesIn(_Base):
    user_id: Optional[int] = None
    chapter_year: Optional[int] = None
    kind: Optional[ChronicleKind] = None
    limit: int = Field(default=100, ge=1, le=500)


class GetChronicleSummaryIn(_Base):
    user_id: Optional[int] = None


class MarkChronicleViewedIn(_Base):
    entry_id: int


class GetPendingCelebrationIn(_Base):
    pass


class WriteJournalIn(_Base):
    title: str = Field(default="", max_length=160)
    summary: str = Field(default="", max_length=10_000)


class UpdateJournalIn(_Base):
    entry_id: int
    title: str = Field(default="", max_length=160)
    summary: str = Field(default="", max_length=10_000)


class GetTodayJournalIn(_Base):
    pass


class CreateManualEntryIn(_Base):
    """Parent-only manual chronicle entry on a child's timeline."""

    user_id: int
    title: str = Field(min_length=1, max_length=160)
    summary: str = Field(default="", max_length=10_000)
    icon_slug: str = Field(default="", max_length=80)
    occurred_on: date
    metadata: dict = Field(default_factory=dict)


class UpdateManualEntryIn(_Base):
    entry_id: int
    title: Optional[str] = Field(default=None, min_length=1, max_length=160)
    summary: Optional[str] = Field(default=None, max_length=10_000)
    icon_slug: Optional[str] = Field(default=None, max_length=80)
    occurred_on: Optional[date] = None
    metadata: Optional[dict] = None


class DeleteChronicleEntryIn(_Base):
    entry_id: int


# ---------------------------------------------------------------------------
# Time entries: clock in / out / void
# ---------------------------------------------------------------------------


class ClockInIn(_Base):
    project_id: int
    user_id: Optional[int] = Field(
        default=None,
        description="Parent-only: clock in on behalf of a child. The child "
                    "must own the project.",
    )


class ClockOutIn(_Base):
    notes: str = Field(default="", max_length=500)
    user_id: Optional[int] = Field(default=None)


class VoidTimeEntryIn(_Base):
    entry_id: int


class GenerateTimecardIn(_Base):
    user_id: int
    week_start: date


class MarkTimecardPaidIn(_Base):
    timecard_id: int
    amount: Optional[Decimal] = Field(
        default=None,
        description="Override payout amount. Defaults to the timecard's "
                    "total_earnings when omitted.",
    )


# ---------------------------------------------------------------------------
# RPG inventory & cosmetics
# ---------------------------------------------------------------------------


CosmeticSlot = Literal[
    "active_frame", "active_title", "active_theme", "active_pet_accessory",
]


class ListInventoryIn(_Base):
    user_id: Optional[int] = None
    item_type: Optional[str] = Field(
        default=None,
        description="Filter by ItemDefinition.item_type slug "
                    "(egg / potion / food / cosmetic_frame / consumable / ...).",
    )


class UseConsumableIn(_Base):
    item_id: int
    user_id: Optional[int] = Field(default=None)


class ListCosmeticsIn(_Base):
    user_id: Optional[int] = None


class EquipCosmeticIn(_Base):
    item_id: int
    user_id: Optional[int] = Field(default=None)


class UnequipCosmeticIn(_Base):
    slot: CosmeticSlot
    user_id: Optional[int] = Field(default=None)


class SetTrophyBadgeIn(_Base):
    badge_id: Optional[int] = Field(
        default=None,
        description="Pass null to clear the current trophy.",
    )
    user_id: Optional[int] = Field(default=None)


# ---------------------------------------------------------------------------
# Daily challenges
# ---------------------------------------------------------------------------


class GetDailyChallengeIn(_Base):
    user_id: Optional[int] = None


class ClaimDailyChallengeIn(_Base):
    user_id: Optional[int] = None


# ---------------------------------------------------------------------------
# Notifications: bulk + count
# ---------------------------------------------------------------------------


class MarkAllNotificationsReadIn(_Base):
    pass


class GetUnreadNotificationCountIn(_Base):
    pass


# ---------------------------------------------------------------------------
# Portfolio: photo + proof delete + ZIP export
# ---------------------------------------------------------------------------


class DeleteProjectPhotoIn(_Base):
    photo_id: int


class DeleteHomeworkProofIn(_Base):
    proof_id: int


class ExportPortfolioIn(_Base):
    user_id: Optional[int] = Field(
        default=None,
        description="Parent-only: export a specific child's portfolio. "
                    "Returns a manifest (file paths + sizes), NOT the ZIP "
                    "bytes — use the REST endpoint to download.",
    )
