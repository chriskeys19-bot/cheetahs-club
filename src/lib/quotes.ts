/**
 * Welcome quotes for the clubhouse.
 *
 * Captains can add, edit, or remove lines here. No database change is required.
 * Keep each `id` stable: a player's recent-quote history is stored against it.
 * Only add a line when both the wording and the attribution are reliable.
 */
export type ClubQuote = {
  id: string
  text: string
  attribution: string
}

export const CLUB_QUOTES: readonly ClubQuote[] = [
  {
    id: 'tendulkar-milestones',
    attribution: 'Sachin Tendulkar',
    text: 'People throw stones at you, and you convert them into milestones.',
  },
  {
    id: 'tendulkar-journey',
    attribution: 'Sachin Tendulkar',
    text: 'My life, between 22 yards for 24 years, it is hard to believe that that wonderful journey has come to an end.',
  },
  {
    id: 'tendulkar-hunger',
    attribution: 'Sachin Tendulkar',
    text: "I hate losing and cricket being my first love, once I enter the ground it's a different zone altogether and that hunger for winning is always there.",
  },
  {
    id: 'dhoni-process',
    attribution: 'MS Dhoni',
    text: 'The process is more important than the result.',
  },
  {
    id: 'dhoni-full-stop',
    attribution: 'MS Dhoni',
    text: "Until the full stop comes, the sentence isn't complete.",
  },
  {
    id: 'dhoni-mirror',
    attribution: 'MS Dhoni',
    text: 'At the end of the day, once the match gets over, if I look into the mirror and honestly say that I tried my best, then I can accept the result.',
  },
  {
    id: 'dhoni-dogs',
    attribution: 'MS Dhoni',
    text: 'I have three dogs at home. Even after losing a series or winning a series, they treat me the same way.',
  },
  {
    id: 'kohli-self-belief',
    attribution: 'Virat Kohli',
    text: 'Self-belief and hard work will always earn you success.',
  },
  {
    id: 'kohli-pressure',
    attribution: 'Virat Kohli',
    text: "I love playing under pressure. In fact, if there's no pressure, then I'm not in the perfect zone.",
  },
  {
    id: 'kohli-passion',
    attribution: 'Virat Kohli',
    text: 'Whatever you want to do, do with full passion and work really hard towards it. Don’t look anywhere else. There will be a few distractions, but if you can be true to yourself, you will be successful for sure.',
  },
  {
    id: 'sehwag-see-ball',
    attribution: 'Virender Sehwag',
    text: 'You just see the ball, hit the ball, and if you see the gap, hit it there.',
  },
  {
    id: 'warne-spin',
    attribution: 'Shane Warne',
    text: "Part of the art of bowling spin is to make the batsman think something special is happening when it isn't.",
  },
  {
    id: 'dravid-merit',
    attribution: 'Rahul Dravid',
    text: 'You control each ball on its merit and stay put at the crease.',
  },
  {
    id: 'james-cricket',
    attribution: 'C. L. R. James',
    text: 'What do they know of cricket who only cricket know?',
  },
  {
    id: 'gilchrist-responsibility',
    attribution: 'Adam Gilchrist',
    text: 'I felt it was time that players made a stand to take back responsibility for the game.',
  },
  {
    id: 'imran-tigers',
    attribution: 'Imran Khan',
    text: 'Fight like cornered tigers.',
  },
  {
    id: 'ali-butterfly',
    attribution: 'Muhammad Ali',
    text: 'Float like a butterfly, sting like a bee.',
  },
  {
    id: 'ali-risks',
    attribution: 'Muhammad Ali',
    text: 'He who is not courageous enough to take risks will accomplish nothing in life.',
  },
  {
    id: 'ali-training',
    attribution: 'Muhammad Ali',
    text: "I hated every minute of training, but I said, 'Don't quit. Suffer now and live the rest of your life as a champion.'",
  },
  {
    id: 'ali-champions',
    attribution: 'Muhammad Ali',
    text: 'Champions aren’t made in gyms. Champions are made from something they have deep inside them — a desire, a dream, a vision.',
  },
  {
    id: 'jordan-failure',
    attribution: 'Michael Jordan',
    text: "I've missed more than 9,000 shots in my career. I've lost almost 300 games. Twenty-six times I've been trusted to take the game-winning shot and missed. I've failed over and over and over again in my life. And that is why I succeed.",
  },
  {
    id: 'jordan-trying',
    attribution: 'Michael Jordan',
    text: "I can accept failure, everyone fails at something. But I can't accept not trying.",
  },
  {
    id: 'jordan-wall',
    attribution: 'Michael Jordan',
    text: "Obstacles don't have to stop you. If you run into a wall, don't turn around and give up. Figure out how to climb it, go through it, or work around it.",
  },
  {
    id: 'jordan-teamwork',
    attribution: 'Michael Jordan',
    text: 'Talent wins games, but teamwork and intelligence win championships.',
  },
  {
    id: 'jordan-make-it-happen',
    attribution: 'Michael Jordan',
    text: 'Some people want it to happen, some wish it would happen, others make it happen.',
  },
  {
    id: 'jordan-weakness',
    attribution: 'Michael Jordan',
    text: 'My attitude is that if you push me towards something that you think is a weakness, then I will turn that perceived weakness into a strength.',
  },
  {
    id: 'kobe-pressure',
    attribution: 'Kobe Bryant',
    text: 'Everything negative — pressure, challenges — is all an opportunity for me to rise.',
  },
  {
    id: 'kobe-work',
    attribution: 'Kobe Bryant',
    text: 'Great things come from hard work and perseverance. No excuses.',
  },
  {
    id: 'kobe-rest',
    attribution: 'Kobe Bryant',
    text: 'Rest at the end, not in the middle.',
  },
  {
    id: 'kobe-give-up',
    attribution: 'Kobe Bryant',
    text: 'The moment you give up is the moment you let someone else win.',
  },
  {
    id: 'wooden-can-do',
    attribution: 'John Wooden',
    text: 'Do not let what you cannot do interfere with what you can do.',
  },
  {
    id: 'wooden-masterpiece',
    attribution: 'John Wooden',
    text: 'Make each day your masterpiece.',
  },
  {
    id: 'wooden-character',
    attribution: 'John Wooden',
    text: 'Be more concerned with your character than your reputation, because your character is what you really are, while your reputation is merely what others think you are.',
  },
  {
    id: 'wooden-details',
    attribution: 'John Wooden',
    text: "It's the little details that are vital. Little things make big things happen.",
  },
  {
    id: 'wooden-keep-you',
    attribution: 'John Wooden',
    text: 'Ability may get you to the top, but it takes character to keep you there.',
  },
  {
    id: 'wooden-hurry',
    attribution: 'John Wooden',
    text: "Be quick, but don't hurry.",
  },
  {
    id: 'wooden-success',
    attribution: 'John Wooden',
    text: 'Success is peace of mind which is a direct result of self-satisfaction in knowing you made the effort to become the best of which you are capable.',
  },
  {
    id: 'lombardi-get-up',
    attribution: 'Vince Lombardi',
    text: "It's not whether you get knocked down; it's whether you get up.",
  },
  {
    id: 'lombardi-perfection',
    attribution: 'Vince Lombardi',
    text: 'Perfection is not attainable, but if we chase perfection we can catch excellence.',
  },
  {
    id: 'lombardi-commitment',
    attribution: 'Vince Lombardi',
    text: 'Individual commitment to a group effort — that is what makes a team work, a company work, a society work, a civilization work.',
  },
  {
    id: 'lombardi-will',
    attribution: 'Vince Lombardi',
    text: 'The difference between a successful person and others is not a lack of strength, not a lack of knowledge, but rather a lack of will.',
  },
  {
    id: 'lombardi-quit',
    attribution: 'Vince Lombardi',
    text: 'Once you learn to quit, it becomes a habit.',
  },
  {
    id: 'lombardi-excellence',
    attribution: 'Vince Lombardi',
    text: "The quality of a person's life is in direct proportion to their commitment to excellence, regardless of their chosen field of endeavor.",
  },
  {
    id: 'lombardi-practice',
    attribution: 'Vince Lombardi',
    text: 'Practice does not make perfect. Only perfect practice makes perfect.',
  },
  {
    id: 'jackson-strength',
    attribution: 'Phil Jackson',
    text: 'The strength of the team is each individual member. The strength of each member is the team.',
  },
  {
    id: 'jackson-we',
    attribution: 'Phil Jackson',
    text: 'Good teams become great ones when the members trust each other enough to surrender the Me for the We.',
  },
  {
    id: 'summitt-inside',
    attribution: 'Pat Summitt',
    text: "You can't always control what goes on outside. But you can always control what goes on inside.",
  },
  {
    id: 'magic-teammates',
    attribution: 'Magic Johnson',
    text: 'Ask not what your teammates can do for you. Ask what you can do for your teammates.',
  },
  {
    id: 'russell-teammates',
    attribution: 'Bill Russell',
    text: "The most important measure of how good a game I played was how much better I'd made my teammates play.",
  },
  {
    id: 'bird-percent',
    attribution: 'Larry Bird',
    text: "I've got a theory that if you give 100 percent all of the time, somehow things will work out in the end.",
  },
  {
    id: 'riley-excellence',
    attribution: 'Pat Riley',
    text: 'Excellence is the gradual result of always striving to do better.',
  },
  {
    id: 'rice-today',
    attribution: 'Jerry Rice',
    text: "Today I will do what others won't, so tomorrow I can accomplish what others can't.",
  },
  {
    id: 'jeter-work',
    attribution: 'Derek Jeter',
    text: "There may be people who have more talent than you, but there's no excuse for anyone to work harder than you do.",
  },
  {
    id: 'berra-over',
    attribution: 'Yogi Berra',
    text: "It ain't over till it's over.",
  },
  {
    id: 'valvano-dont-give-up',
    attribution: 'Jim Valvano',
    text: "Don't give up. Don't ever give up.",
  },
  {
    id: 'schembechler-team',
    attribution: 'Bo Schembechler',
    text: 'No man is more important than the team. The team, the team, the team.',
  },
  {
    id: 'robinson-impact',
    attribution: 'Jackie Robinson',
    text: 'A life is not important except in the impact it has on other lives.',
  },
  {
    id: 'robinson-respect',
    attribution: 'Jackie Robinson',
    text: "I'm not concerned with your liking or disliking me. All I ask is that you respect me as a human being.",
  },
  {
    id: 'gehrig-luckiest',
    attribution: 'Lou Gehrig',
    text: 'Today, I consider myself the luckiest man on the face of the earth.',
  },
  {
    id: 'ashe-start',
    attribution: 'Arthur Ashe',
    text: 'Start where you are. Use what you have. Do what you can.',
  },
  {
    id: 'ashe-journey',
    attribution: 'Arthur Ashe',
    text: 'Success is a journey, not a destination. The doing is often more important than the outcome.',
  },
  {
    id: 'ashe-heroism',
    attribution: 'Arthur Ashe',
    text: 'True heroism is remarkably sober, very undramatic. It is not the urge to surpass all others at whatever cost, but the urge to serve others at whatever cost.',
  },
  {
    id: 'gibson-helped',
    attribution: 'Althea Gibson',
    text: 'No matter what accomplishments you make, somebody helped you.',
  },
  {
    id: 'gibson-somebody',
    attribution: 'Althea Gibson',
    text: "I always wanted to be somebody. If I made it, it's half because I was game enough to take a lot of punishment along the way and half because there were a lot of people who cared enough to help me.",
  },
  {
    id: 'king-champions',
    attribution: 'Billie Jean King',
    text: 'Champions keep playing until they get it right.',
  },
  {
    id: 'king-pressure',
    attribution: 'Billie Jean King',
    text: 'Pressure is a privilege.',
  },
  {
    id: 'serena-recover',
    attribution: 'Serena Williams',
    text: 'A champion is defined not by their wins but by how they can recover when they fall.',
  },
  {
    id: 'serena-hours',
    attribution: 'Serena Williams',
    text: 'Luck has nothing to do with it, because I have spent many, many hours, countless hours, on the court working for my one moment in time, not knowing when it would come.',
  },
  {
    id: 'navratilova-victory',
    attribution: 'Martina Navratilova',
    text: 'The moment of victory is much too short to live for that and nothing else.',
  },
  {
    id: 'navratilova-worst',
    attribution: 'Martina Navratilova',
    text: 'The mark of great sportsmen and women is not how good they are at their best, but how good they are at their worst.',
  },
  {
    id: 'federer-effortless',
    attribution: 'Roger Federer',
    text: 'Effortless is a myth.',
  },
  {
    id: 'federer-points',
    attribution: 'Roger Federer',
    text: 'In the 1,526 singles matches I played in my career, I won almost 80 percent of those matches. What percentage of the points did I win? Only 54 percent.',
  },
  {
    id: 'nadal-fear',
    attribution: 'Rafael Nadal',
    text: 'Losing is not my enemy. Fear of losing is my enemy.',
  },
  {
    id: 'biles-first',
    attribution: 'Simone Biles',
    text: "I'm not the next Usain Bolt or Michael Phelps. I'm the first Simone Biles.",
  },
  {
    id: 'biles-risks',
    attribution: 'Simone Biles',
    text: "I'd rather regret the risks that didn't work out than the chances I didn't take at all.",
  },
  {
    id: 'phelps-dream',
    attribution: 'Michael Phelps',
    text: "You can't put a limit on anything. The more you dream, the farther you get.",
  },
  {
    id: 'owens-battles',
    attribution: 'Jesse Owens',
    text: "The battles that count aren't the ones for gold medals. The struggles within yourself — the invisible, inevitable battles inside all of us — that's where it's at.",
  },
  {
    id: 'owens-dreams',
    attribution: 'Jesse Owens',
    text: 'We all have dreams. But in order to make dreams come into reality, it takes an awful lot of determination, dedication, self-discipline, and effort.',
  },
  {
    id: 'rudolph-triumph',
    attribution: 'Wilma Rudolph',
    text: "The triumph can't be had without the struggle.",
  },
  {
    id: 'rudolph-greatness',
    attribution: 'Wilma Rudolph',
    text: 'Never underestimate the power of dreams and the influence of the human spirit. We are all the same in this notion: the potential for greatness lives within each of us.',
  },
  {
    id: 'kipchoge-limited',
    attribution: 'Eliud Kipchoge',
    text: 'No human is limited.',
  },
  {
    id: 'prefontaine-gift',
    attribution: 'Steve Prefontaine',
    text: 'To give anything less than your best is to sacrifice the gift.',
  },
  {
    id: 'prefontaine-guts',
    attribution: 'Steve Prefontaine',
    text: 'A lot of people run a race to see who is fastest. I run to see who has the most guts.',
  },
  {
    id: 'bannister-effort',
    attribution: 'Roger Bannister',
    text: 'The man who can drive himself further once the effort gets painful is the man who will win.',
  },
  {
    id: 'zatopek-marathon',
    attribution: 'Emil Zátopek',
    text: 'If you want to win something, run 100 meters. If you want to experience something, run a marathon.',
  },
  {
    id: 'switzer-marathon',
    attribution: 'Kathrine Switzer',
    text: 'If you are losing faith in human nature, go out and watch a marathon.',
  },
  {
    id: 'hamm-fire',
    attribution: 'Mia Hamm',
    text: 'I am building a fire, and every day I train, I add more fuel. At just the right moment, I light the match.',
  },
  {
    id: 'hamm-vision',
    attribution: 'Mia Hamm',
    text: 'The vision of a champion is bent over, drenched in sweat, at the point of exhaustion, when nobody else is looking.',
  },
  {
    id: 'wambach-failure',
    attribution: 'Abby Wambach',
    text: "Failure is not something to be ashamed of. It's something to be powered by.",
  },
  {
    id: 'pele-success',
    attribution: 'Pelé',
    text: 'Success is no accident. It is hard work, perseverance, learning, studying, sacrifice and most of all, love of what you are doing or learning to do.',
  },
  {
    id: 'pele-victory',
    attribution: 'Pelé',
    text: 'The more difficult the victory, the greater the happiness in winning.',
  },
  {
    id: 'cruyff-simple',
    attribution: 'Johan Cruyff',
    text: 'Playing football is very simple, but playing simple football is the hardest thing there is.',
  },
  {
    id: 'cruyff-disadvantage',
    attribution: 'Johan Cruyff',
    text: 'Every disadvantage has its advantage.',
  },
  {
    id: 'messi-dream',
    attribution: 'Lionel Messi',
    text: 'You have to fight to reach your dream. You have to sacrifice and work hard for it.',
  },
  {
    id: 'ronaldo-talent',
    attribution: 'Cristiano Ronaldo',
    text: 'Talent without working hard is nothing.',
  },
  {
    id: 'gretzky-shots',
    attribution: 'Wayne Gretzky',
    text: "You miss 100 percent of the shots you don't take.",
  },
  {
    id: 'shankly-team',
    attribution: 'Bill Shankly',
    text: "The socialism I believe in is everybody working for the same goal and everybody having a share in the rewards. That's how I see football, that's how I see life.",
  },
  {
    id: 'palmer-effort',
    attribution: 'Arnold Palmer',
    text: 'Always make a total effort, even when the odds are against you.',
  },
  {
    id: 'mandela-sport',
    attribution: 'Nelson Mandela',
    text: 'Sport has the power to change the world. It has the power to inspire. It has the power to unite people in a way that little else does.',
  },
  {
    id: 'roosevelt-arena',
    attribution: 'Theodore Roosevelt',
    text: 'It is not the critic who counts. The credit belongs to the man who is actually in the arena.',
  },
]
