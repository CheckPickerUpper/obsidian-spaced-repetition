import moment from "moment";
import { State } from "ts-fsrs";

import { DEFAULT_SETTINGS, SRSettings, upgradeSettings } from "src/data/settings";
import { ReviewResponse } from "src/scheduling/algorithms/base/repetition-item";
import { RepItemScheduleInfoFsrs } from "src/scheduling/algorithms/fsrs/rep-item-schedule-info-fsrs";
import { RepItemScheduleInfoOsr } from "src/scheduling/algorithms/osr/rep-item-schedule-info-osr";
import { checkForLeech } from "src/scheduling/leech-detection";
import { setupStaticDateProvider20230906 } from "src/utils/dates";

function fsrs(lapses: number): RepItemScheduleInfoFsrs {
    return new RepItemScheduleInfoFsrs(
        moment("2023-09-06T00:10:00.000Z"),
        0,
        6,
        0.5,
        State.Relearning,
        10,
        lapses,
        0,
        moment("2023-09-06T00:00:00.000Z"),
    );
}

beforeAll(() => {
    setupStaticDateProvider20230906();
});

describe("checkForLeech", () => {
    const settings: SRSettings = { ...DEFAULT_SETTINGS, leechThreshold: 8 };

    test("Again that brings lapses to the threshold is a leech", () => {
        expect(checkForLeech(settings, ReviewResponse.Again, fsrs(7), fsrs(8))).toEqual({
            isLeech: true,
            lapses: 8,
            action: "suspend",
        });
    });

    test("Further lapses beyond the threshold are still leeches", () => {
        expect(checkForLeech(settings, ReviewResponse.Again, fsrs(8), fsrs(9)).isLeech).toBe(true);
    });

    test("Below threshold is not a leech", () => {
        expect(checkForLeech(settings, ReviewResponse.Again, fsrs(6), fsrs(7)).isLeech).toBe(false);
    });

    test("Again without a new lapse (e.g. learning card) is not a leech", () => {
        expect(checkForLeech(settings, ReviewResponse.Again, fsrs(8), fsrs(8)).isLeech).toBe(false);
    });

    test("Only Again answers can create a leech", () => {
        for (const response of [ReviewResponse.Hard, ReviewResponse.Good, ReviewResponse.Easy]) {
            expect(checkForLeech(settings, response, fsrs(7), fsrs(8)).isLeech).toBe(false);
        }
    });

    test("Threshold 0 disables leech detection", () => {
        const disabled: SRSettings = { ...settings, leechThreshold: 0 };
        expect(checkForLeech(disabled, ReviewResponse.Again, fsrs(0), fsrs(100)).isLeech).toBe(
            false,
        );
    });

    test("SM-2 schedules don't track lapses, so they are never leeches", () => {
        const sm2 = RepItemScheduleInfoOsr.fromDueDateStr("2023-09-07", 1, 230);
        expect(checkForLeech(settings, ReviewResponse.Again, sm2, sm2).isLeech).toBe(false);
    });

    test("A new card (no old schedule) counts its lapses from 0", () => {
        const low: SRSettings = { ...settings, leechThreshold: 1 };
        expect(checkForLeech(low, ReviewResponse.Again, null, fsrs(1)).isLeech).toBe(true);
    });

    test("Reports the configured action", () => {
        const notice: SRSettings = { ...settings, leechAction: "notice" };
        expect(checkForLeech(notice, ReviewResponse.Again, fsrs(7), fsrs(8)).action).toEqual(
            "notice",
        );
    });
});

describe("Leech settings", () => {
    test("Defaults", () => {
        expect(DEFAULT_SETTINGS.leechThreshold).toEqual(8);
        expect(DEFAULT_SETTINGS.leechAction).toEqual("suspend");
    });

    test("upgradeSettings fills in missing or invalid values", () => {
        const settings = { ...DEFAULT_SETTINGS } as SRSettings;
        delete (settings as Partial<SRSettings>).leechThreshold;
        (settings as unknown as Record<string, unknown>).leechAction = "tag";
        upgradeSettings(settings);
        expect(settings.leechThreshold).toEqual(8);
        expect(settings.leechAction).toEqual("suspend");

        const negative: SRSettings = { ...DEFAULT_SETTINGS, leechThreshold: -1 };
        upgradeSettings(negative);
        expect(negative.leechThreshold).toEqual(8);
    });

    test("upgradeSettings keeps valid values", () => {
        const settings: SRSettings = {
            ...DEFAULT_SETTINGS,
            leechThreshold: 0,
            leechAction: "notice",
        };
        upgradeSettings(settings);
        expect(settings.leechThreshold).toEqual(0);
        expect(settings.leechAction).toEqual("notice");
    });
});
