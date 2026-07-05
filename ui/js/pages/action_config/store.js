export const AC_STATE = {
  activeTab: "profile",
  profileItems: [],
  selectedType: "",
  selectedFilename: "",
  profileDetail: null,
  currentProfile: null,

  summary: null,
  automation: null,
  actuators: [],
  selectedActuatorId: "",
  draftActuatorReturnId: "",
  actionUnits: [],
  selectedUnitId: "",
  draftUnitReturnId: "",
  actionTasks: [],
  selectedTaskId: "",
  actionRules: [],
  selectedRuleId: "",
  actionSchedules: [],
  selectedScheduleId: "",
  taskDraftSteps: [],
  actionLogs: []
};

export function resetActionConfigState() {
  AC_STATE.profileItems = [];
  AC_STATE.selectedType = "";
  AC_STATE.selectedFilename = "";
  AC_STATE.profileDetail = null;
  AC_STATE.currentProfile = null;
  AC_STATE.summary = null;
  AC_STATE.automation = null;
  AC_STATE.selectedActuatorId = "";
  AC_STATE.draftActuatorReturnId = "";
  AC_STATE.selectedUnitId = "";
  AC_STATE.draftUnitReturnId = "";
  AC_STATE.selectedTaskId = "";
  AC_STATE.selectedRuleId = "";
  AC_STATE.selectedScheduleId = "";
  AC_STATE.taskDraftSteps = [];
}
