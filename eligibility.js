/** From memory... possible errata in criteria
 * 
 * Determine the eligibility of applicants based on the following criteria:
 *
 * 1. Age: Less than 18 or 65 and older
 * 2. Income for household size: <-- *I suspect this was my earlier error. I believe I used ">" rather than "<" in the logic.*
 *     1 - $18000
 *     2 - $24000
 *     3 - $36000
 *     4 - $48000
 * 3. Pregnancy
 *
 * If ANY of the above are true, the applicant is eligible.
*/

// This could be pulled from data or put in the environment like I did here.
// Putting it in config instead of a coded ENUM makes it easier to change without deployment,
// although that config should be versioned in a production environment.
process.env.maxLowerAge = 18;
process.env.minUpperAge = 65;
process.env.incomeLevels = JSON.stringify({
        1: 18000,
        2: 24000,
        3: 36000,
        4: 48000,
    });
process.env.eligibilityRequirements = JSON.stringify({
    age: true,
    income: false,
    pregnancy: true,
});

// This would likely be from a data store/source of some sort. Data in code is
// often hugely problematic in real software.
const applicants = [
    {
        name: "Applicant 1: young adult with income above poverty",
        age: 24,
        income: 36000,
        householdSize: 1,
        pregnant: false,
    },
    {
        name: "Applicant 2: young adult with income below poverty",
        age: 24,
        income: 16000,
        householdSize: 1,
        pregnant: false,
    },
    {
        name: "Applicant 3: minor with income above poverty",
        age: 17,
        income: 36000,
        householdSize: 1,
        pregnant: false,
    },
    {
        name: "Applicant 4: minor with income below poverty",
        age: 17,
        income: 16000,
        householdSize: 1,
        pregnant: false,
    },
    {
        name: "Applicant 5: young adult with income above poverty, pregnant",
        age: 24,
        income: 36000,
        householdSize: 2,
        pregnant: true,
    },
    {
        name: "Applicant 6: young adult with income below poverty, pregnant",
        age: 24,
        income: 23000,
        householdSize: 2,
        pregnant: true,
    },
    {
        name: "Applicant 7: elderly adult with income above poverty",
        age: 68,
        income: 36000,
        householdSize: 1,
        pregnant: false,
    },
    {
        name: "Applicant 8: elderly adult with income below poverty",
        age: 68,
        income: 16000,
        householdSize: 1,
        pregnant: false,
    },
];

// Best to encapsulate logic, especially if reusable elsewhere. Often simply cleaner as well.
class Applicant {

    constructor(applicant) {
        this.name = applicant.name;
        this.age = applicant.age;
        this.income = applicant.income;
        this.householdSize = applicant.householdSize;
        this.pregnant = applicant.pregnant;
    }

    isAgeEligible() {
        return this.age < process.env.maxLowerAge
            || this.age >= process.env.minUpperAge;
    }

    isIncomeEligible() {
        // Ideally, this class wouldn't know it had to parse the environment variable.
        return this.income < JSON.parse(process.env.incomeLevels)[this.householdSize];
    }

    isPregnant() {
        return this.pregnant;
    }

    isEligible() {
        // Ideally, this class wouldn't know it had to parse the environment variable.
        const eligibilityRequirements = JSON.parse(process.env.eligibilityRequirements);
        return (eligibilityRequirements.pregnancy && this.isPregnant())
            || (eligibilityRequirements.age && this.isAgeEligible())
            || (eligibilityRequirements.income && this.isIncomeEligible());
    }
}

applicants.forEach((applicant) => {
    const currentApplicant = new Applicant(applicant);
    console.log(`${applicant.name} -- ${currentApplicant.isEligible()}`);
});