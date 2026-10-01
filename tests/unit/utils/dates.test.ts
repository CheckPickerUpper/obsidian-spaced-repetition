import moment from "moment";

import {
    formatDate,
    formatDateWithMoment,
    globalDateProvider,
    IDayBoundary,
} from "src/utils/dates";

describe("Format date", () => {
    test("Different input overloads", () => {
        expect(formatDate(new Date(2023, 0, 1))).toBe("2023-01-01");
        expect(formatDate(2023, 1, 1)).toBe("2023-01-01");
        expect(formatDate(1672531200000)).toBe("2023-01-01");
    });

    test("handles a leap year date", () => {
        expect(formatDate(2020, 2, 29)).toBe("2020-02-29");
    });
});

describe("Format date with moment", () => {
    test("Different input overloads", () => {
        expect(formatDateWithMoment(1672531200000, "YYYY-MM-DD")).toBe("2023-01-01");
    });
});

describe("LiveDateProvider", () => {
    test("now", () => {
        expect(globalDateProvider.now.year()).toBe(moment().year());
        expect(globalDateProvider.now.month()).toBe(moment().month());
        expect(globalDateProvider.now.week()).toBe(moment().week());
        expect(globalDateProvider.now.date()).toBe(moment().date());
    });

    test("today & dateBoundary", () => {
        expect(globalDateProvider.today.year()).toBe(moment().year());
        expect(globalDateProvider.today.month()).toBe(moment().month());
        expect(globalDateProvider.today.week()).toBe(moment().week());
        expect(globalDateProvider.today.date()).toBe(moment().date());
        expect(globalDateProvider.getDayBoundary()).toBe(null);

        let dayBoundary: IDayBoundary = { hour: 0, minute: 0, second: 0 };
        globalDateProvider.setDayBoundary(dayBoundary);
        expect(globalDateProvider.getDayBoundary()).toEqual(dayBoundary);

        expect(globalDateProvider.today.year()).toBe(moment().year());
        expect(globalDateProvider.today.month()).toBe(moment().month());
        expect(globalDateProvider.today.week()).toBe(moment().week());
        expect(globalDateProvider.today.date()).toBe(moment().date());

        dayBoundary = { hour: 23, minute: 0, second: 0 };
        globalDateProvider.setDayBoundary(dayBoundary);
        expect(globalDateProvider.getDayBoundary()).toEqual(dayBoundary);

        jest.useFakeTimers();
        try {
            // Before the boundary it is still the previous day
            jest.setSystemTime(new Date(2024, 2, 1, 22, 0, 0));
            expect(globalDateProvider.today.format("YYYY-MM-DD")).toBe("2024-02-29");

            jest.setSystemTime(new Date(2024, 2, 1, 23, 30, 0));
            expect(globalDateProvider.today.format("YYYY-MM-DD")).toBe("2024-03-01");
        } finally {
            jest.useRealTimers();
            globalDateProvider.setDayBoundary(null);
        }
    });

    test("today respects a day boundary on the hour", () => {
        jest.useFakeTimers();
        try {
            globalDateProvider.setDayBoundary({ hour: 4, minute: 0, second: 0 });

            jest.setSystemTime(new Date(2024, 2, 10, 3, 59, 0));
            expect(globalDateProvider.today.format("YYYY-MM-DD")).toBe("2024-03-09");

            jest.setSystemTime(new Date(2024, 2, 10, 4, 0, 0));
            expect(globalDateProvider.today.format("YYYY-MM-DD")).toBe("2024-03-10");
        } finally {
            jest.useRealTimers();
            globalDateProvider.setDayBoundary(null);
        }
    });
});
