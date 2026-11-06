// ============================================================
// BABY SHOWER JEOPARDY — GAME CONTENT
// ============================================================
// This is the ONLY file you need to edit to make this your own.
// Everything below is placeholder trivia — swap it out for your
// own categories, clues, answers, point values, even the title
// and currency label. The app reads this file to build the board.
//
// STRUCTURE:
//   - Exactly 5 clues per category (classic Jeopardy column of 5).
//   - You can have as many categories as you want — the board
//     grid adjusts automatically (classic Jeopardy uses 6).
//   - "value" is the point award for getting the clue right.
//   - "clue" is what's shown/read aloud first.
//   - "answer" is revealed after — written Jeopardy-style as a
//     question ("What is...?") if you want the classic flavor,
//     but totally optional — plain answers work fine too.
// ============================================================

window.GAME_DATA = {
  title: "Baby Shower Jeopardy!",
  subtitle: "Get ready to question everything (literally)",

  // Shown next to every point value on the board, e.g. "100 pts"
  currencyLabel: "pts",

  // Note: team names/count are NOT set here anymore — they're registered
  // once on the Leaderboard page and shared across every game in the app.

  categories: [
    {
      title: "Nursery Rhymes",
      clues: [
        { value: 100, clue: "This rhyme features a cow jumping over a celestial body.", answer: "What is “Hey Diddle Diddle”?" },
        { value: 200, clue: "This egg-shaped character “had a great fall” and couldn’t be put back together.", answer: "Who is Humpty Dumpty?" },
        { value: 300, clue: "In this rhyme, a spider keeps climbing up this part of the house, despite the rain.", answer: "What is a waterspout? (“The Itsy Bitsy Spider”)" },
        { value: 400, clue: "This lullaby about a star shares its exact tune with the alphabet song.", answer: "What is “Twinkle Twinkle Little Star”?" },
        { value: 500, clue: "In this lullaby, a baby is rocked in a treetop cradle that falls “down” when the bough breaks.", answer: "What is “Rock-a-bye Baby”?" }
      ]
    },
    {
      title: "Baby Animals",
      clues: [
        { value: 100, clue: "The name for a baby dog.", answer: "What is a puppy?" },
        { value: 200, clue: "The name for a baby cat.", answer: "What is a kitten?" },
        { value: 300, clue: "The name for a baby kangaroo.", answer: "What is a joey?" },
        { value: 400, clue: "The name for a baby deer.", answer: "What is a fawn?" },
        { value: 500, clue: "The name for a baby owl.", answer: "What is an owlet?" }
      ]
    },
    {
      title: "Celebrity Baby Names",
      clues: [
        { value: 100, clue: "Gwyneth Paltrow and Chris Martin named their daughter after this fruit.", answer: "What is Apple?" },
        { value: 200, clue: "Kim Kardashian and Kanye West’s first daughter shares her name with this compass direction.", answer: "What is North (West)?" },
        { value: 300, clue: "Beyoncé and Jay-Z’s twins are named Rumi and this.", answer: "What is Sir?" },
        { value: 400, clue: "Elon Musk and Grimes’s son X Æ A-12 goes by this one-letter nickname.", answer: "What is X?" },
        { value: 500, clue: "This “Friends” actress named her daughter with David Arquette Coco Riley.", answer: "Who is Courteney Cox?" }
      ]
    },
    {
      title: "Guess That Baby Gear",
      clues: [
        { value: 100, clue: "This gear keeps baby secured while you push them around the block.", answer: "What is a stroller?" },
        { value: 200, clue: "This soft fabric square catches spit-up on your shoulder.", answer: "What is a burp cloth?" },
        { value: 300, clue: "This device lets parents hear baby crying from another room.", answer: "What is a baby monitor?" },
        { value: 400, clue: "This piece of furniture has rails to keep baby safely contained for sleep.", answer: "What is a crib?" },
        { value: 500, clue: "This gear straps to the chest or back to carry baby hands-free.", answer: "What is a baby carrier?" }
      ]
    },
    {
      title: "Pregnancy & Due Dates",
      clues: [
        { value: 100, clue: "The average human pregnancy lasts this many weeks.", answer: "What is 40 weeks?" },
        { value: 200, clue: "This final trimester runs from week 28 until birth.", answer: "What is the third trimester?" },
        { value: 300, clue: "This medical professional specializes in delivering babies.", answer: "What is an OB-GYN (or midwife)?" },
        { value: 400, clue: "This imaging test, often done around 20 weeks, can reveal baby’s sex.", answer: "What is an ultrasound?" },
        { value: 500, clue: "This hormone detected in pregnancy tests stands for human chorionic this.", answer: "What is gonadotropin (hCG)?" }
      ]
    },
    {
      title: "Mom & Dad-isms",
      clues: [
        { value: 100, clue: "This fluid-filled bag typically “breaks” shortly before or during labor.", answer: "What is the water (amniotic sac)?" },
        { value: 200, clue: "This term describes a baby's first bowel movement, a sticky dark substance.", answer: "What is meconium?" },
        { value: 300, clue: "This soft spot on a newborn's skull hasn't fully fused yet.", answer: "What is the fontanelle?" },
        { value: 400, clue: "This nighttime task involves getting up every few hours to feed a newborn.", answer: "What is a night feed?" },
        { value: 500, clue: "This swaddling technique mimics the womb to help babies sleep longer.", answer: "What is swaddling?" }
      ]
    }
  ]
};
