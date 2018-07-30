const Discord = require('discord.js');
const Chata = require('chata-client');
const redis = require('redis');

// User config file
const config = require('./config/config.json');

const discordClient = new Discord.Client();
const chataClient = new Chata();
const redisClient = new redis.createClient();

const { promisify } = require('util');

// Screw Promisifying things, just give me native promises

const redisComm = {
	sadd: promisify(redisClient.sadd).bind(redisClient),
	srem: promisify(redisClient.srem).bind(redisClient),
	sismember: promisify(redisClient.sismember).bind(redisClient),
	smembers: promisify(redisClient.smembers).bind(redisClient),
	get: promisify(redisClient.get).bind(redisClient),
	set: promisify(redisClient.set).bind(redisClient),
	del: promisify(redisClient.del).bind(redisClient)
};

async function removeHook(discordId, tokaUsername, force=false) {
	if (force || (redisComm.get(`messageme:hooks:${tokaUsername}:linked`) === 'false')) {
		await redisComm.srem('messageme:hooks', tokaUsername);

		await redisComm.del(`messageme:hooks:${discordId}:tokausername`);
		await redisComm.del(`messageme:hooks:${tokaUsername}:discordid`);
		await redisComm.del(`messageme:hooks:${tokaUsername}:linked`);
		await redisComm.del(`messageme:hooks:${tokaUsername}:linkrequestexpires`);
		await redisComm.del(`messageme:hooks:${tokaUsername}:notify`);
		return true;
	}
	return false;
}

// Connection handling

discordClient.on('ready', () => {
	console.log('Connected to Discord');
});

discordClient.on('disconnect', () => {
	console.log('Disconnected from Discord');
});

discordClient.on('error', err => {
	console.log(err);
});

chataClient.on('connect', () => {
	chataClient.join('toka');
	console.log('Connected to Toka');
});

chataClient.on('disconnect', () => {
	console.log('Disconnected from Toka');
});

// Message handling

discordClient.on('message', async message => {
	if ((message.cleanContent.startsWith('n') || message.cleanContent.startsWith('y'))) {
		const discordId = message.author.id;
		const tokaUsername = await redisComm.get(`messageme:hooks:${discordId}:tokausername`);
		if (tokaUsername && (await redisComm.get(`messageme:hooks:${tokaUsername}:linked`) === 'false'))
			if (await redisComm.get(`messageme:hooks:${tokaUsername}:linkrequestexpires`))
				if (message.cleanContent.startsWith('y')) {
					await redisComm.set(`messageme:hooks:${tokaUsername}:linked`, true);
					message.reply('Accounts connected');
				} else
					await removeHook(discordId, tokaUsername);
			else
				await removeHook(discordId, tokaUsername);
	}
});

chataClient.on('message', async message => {
	const text = message.text.split(' ');
	const tokaUsername = message.username;
	if (message.text.startsWith(config.chata.prefix)) {
		switch(text.shift().slice(1)) {
			case 'commands':
				chataClient.sendMessage(message.chatroomId, 'catpa');
				break;
			case 'link':
				const discordId = text.shift();
				if (discordId) {
					if (!await redisComm.sismember('messageme:hooks', tokaUsername))
						await redisComm.sadd('messageme:hooks', tokaUsername);

					await redisComm.set(`messageme:hooks:${discordId}:tokausername`, tokaUsername);
					await redisComm.set(`messageme:hooks:${tokaUsername}:discordid`, discordId);
					await redisComm.set(`messageme:hooks:${tokaUsername}:linked`, false);
					await redisComm.set(`messageme:hooks:${tokaUsername}:linkrequestexpires`, true, 'EX', 60);

					const discordUser = await discordClient.fetchUser(discordId);
					discordUser.send(`Hello, ${tokaUsername} is requesting that your discord account be linked to their toka account, do you accept? [yes/no] (expires in 1 min)`);

					setTimeout(removeHook.bind(undefined, discordId, tokaUsername), 60000);
				} else
					chataClient.sendMessage(message.chatroomId, `Usage: ${config.chata.prefix}link [discord Id]`);
				break;
			case 'notifyme':
				switch(text.shift()) {
					case 'on':
						await redisComm.set(`messageme:hooks:${tokaUsername}:notify`, true);
						chataClient.sendMessage(message.chatroomId, 'You will be notified of any new @s');
						break;
					case 'off':
						await redisComm.set(`messageme:hooks:${tokaUsername}:notify`, false);
						chataClient.sendMessage(message.chatroomId, 'Notifications turned off');
						break;
					default:
						chataClient.sendMessage(message.chatroomId, `Usage: ${config.chata.prefix}notifyme [on|off]`);
				}
				break;
			case 'arc':
				chataClient.sendMessage(message.chatroomId, 'DANG IT ARC!');
				break;
		}
	} else {
		const mentionable = await redisComm.smembers('messageme:hooks');
		const discordMessage = {embed: {
			title: message.username,
			description: message.text,
			url: `https://toka.io/${message.chatroomId}`
		}};

		text.forEach(async word => {
			const mentionedName = word.slice(1).replace(/\W+.*/gmi, '');
			if (word.startsWith('@') &&	mentionable.includes(mentionedName) && (await redisComm.get(`messageme:hooks:${mentionedName}:notify`) === 'true')) {
				const discordUser = await discordClient.fetchUser(await redisComm.get(`messageme:hooks:${mentionedName}:discordid`));
				await discordUser.send(discordMessage);
			}
		});
	}
});

// Redis handles

redisClient.on('error', err => {
	console.log(err);
});

// Logging in

discordClient.login(config.discord.token);
chataClient.login(config.chata.username);