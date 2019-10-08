#!/usr/bin/env node
const inquirer = require('inquirer');
const program = require('commander');
const util = require('util');
// const exec = util.promisify(require('child_process').exec);
const spawn = util.promisify(require('child_process').spawn);
const { spawnSync, execSync } = require('child_process');
const { description, version } = require('./package.json');

program
  .description(description)
  .version(version, '-v, - version');

program
  .command('new <stack_name>')
  .description('Create a new wordpress stack')
  .action(async (stackName, env) => {
    console.log(`Create new stack datafiles in stack/${stackName}`);
    dockerDown();
    createStack(stackName);
    console.log('Running command for selecting this stack');
    linkStack(stackName);
    dockerUp();
    console.log('Done');
  });

program
  .command('select <stack_name>')
  .description('Select the stack you want to use. Also, this command brings the stack up on http://localhost.')
  .action(async (stackName, env) => {
    console.log(`Symlinking stack/${stackName} to data/`);
    dockerDown();
    linkStack(stackName);
    dockerUp();
    console.log('Done');
  });

program
  .command('copy')
  .description('Copy a remote wordpress instance to a stack (Can be tested on http://localhost)')
  .action(async (env) => {
    const stackName = getCurrentStack();
    let answers = await inquirer.prompt([
      { type: 'confirm', name: 'confirmed', message: `This will override the stack "${stackName}". Are you sure you want to continue` },
    ]);
    if (answers.confirmed) {
      console.log(`Restarting server for stack "${stackName}"`);
      // dockerDown();
      // linkStack(stackName);
      // dockerUp();
      console.log(`Changed selected stack to "${stackName}"`);
      let res = cmd('ls ./data', true);
      let genConfig = true;
      if (res.toString().indexOf('config.dotfile') > -1) {
        res = cmd('cat ./data/config.dotfile', true);
        console.log('The last time you copied this website you used the following configuration.');
        console.log(res.toString());
        answers = await inquirer.prompt([
          { type: 'confirm', name: 'confirmed', message: 'Regenerate the configuration for copy (No to continue with current configuration)?' },
        ]);
        if (!answers.confirmed) {
          genConfig = false;
        }
      }
      if (genConfig) {
        answers = await inquirer.prompt([
          { name: 'sshHost', message: 'What is the SSH hostname or ip address where your current wordpress site is hosted (ex: example.com)?' },
          { name: 'sshUser', message: 'What is the SSH username?' },
          { name: 'sshDir', message: 'What is the directory on your wordpress host where your wordpress files are hosted?' },
          { name: 'url', message: 'What is the url with with the leading http(s) for your wordpress website (example: http://example.com or http://example.com/blog, This is used to convert the wordpress url on localhost)?' },
        ]);
        cmd(`echo SHOST=\\"${answers.sshHost}\\" > ./data/config.dotfile`);
        cmd(`echo SUSER=\\"${answers.sshUser}\\" >> ./data/config.dotfile`);
        cmd(`echo SDIR=\\"${answers.sshDir}\\" >> ./data/config.dotfile`);
        cmd(`echo SOURCE_URL=\\"${answers.url}\\" >> ./data/config.dotfile`);
      }
      console.log(`Serving "${getCurrentStack()}"`);
      dockerDown();
      cleanStack(stackName);
      linkStack(stackName);
      dockerUp();
      console.log(`Served "${getCurrentStack()}" on http://localhost`);

      console.log('Copying remote stack to the currently selected stack');
      copy();

      console.log('Your website is served on http://localhost');
    } else {
      console.log('Process canceled');
    }
  });

program
  .command('deploy')
  .description('Deploy static site to aws using pulumi.')
  .action(async (env) => {
    const stackName = getCurrentStack();
    dockerDown();
    dockerUp();
    const res = cmd('ls ./data/html-static/localhost', true);
    if (res.indexOf('index.html') === -1) {
      const answers = await inquirer.prompt([
        { type: 'confirm', name: 'confirmed', message: 'Static content has not yet been generated for the wordpress site. Generate now?' },
      ]);
      if (!answers.confirmed) {
        console.log('You have not confirmed that you wnat to generate the static content.');
        process.exit(0);
      }
      cmd('./bin/create_static.sh');
    } else {
      const answers = await inquirer.prompt([
        { type: 'confirm', name: 'confirmed', message: 'The static html has already been generated but it is unknown if it is stale or not. Do you want to regenerate the static html before continueing?' },
      ]);
      if (answers.confirmed) {
        cmd('./bin/create_static.sh');
      }
    }
    const res2 = cmd('ls ./deploy', true);
    if (res2.indexOf(stackName) === -1) {
      pulumiCmd(`pulumi stack init ${stackName}`);
      const answers = await inquirer.prompt([
        { name: 'targetDomain', message: 'Enter the domain in AWS route53 that you will be using (ex: example.com)?' },
        { type: 'confirm', name: 'setupEmailForwarding', message: 'Would you like to setup wildcard email forwarding?' },
      ]);
      pulumiCmd('pulumi config set aws:region us-east-1');
      pulumiCmd(`pulumi config set static-website:targetDomain ${answers.targetDomain}`);
      pulumiCmd(`pulumi config set static-website:setupEmailForwarding ${answers.setupEmailForwarding}`);
      if (answers.setupEmailForwarding) {
        const emailAnswers = await inquirer.prompt([
          { name: 'forwardFromEmail', message: 'Enter the email that fowarded emails should come from (Must be @targetDomain. Ex: noreply@example.com)?' },
          { name: 'forwardToEmail', message: 'What email should emails be forwarded to (ex: example@gmail.com)? You may have to manually verify this email in the aws console for SES.' },
        ]);
        pulumiCmd(`pulumi config set static-website:forwardFromEmail ${emailAnswers.forwardFromEmail}`);
        pulumiCmd(`pulumi config set static-website:forwardTo ${emailAnswers.forwardToEmail}`);
        pulumiCmd(`pulumi config set static-website:pathToWebsiteContents ../stack/${stackName}/html-static/localhost`);
      }
    } else {
      pulumiCmd(`pulumi stack select ${stackName}`);
    }
    pulumiCmd('npm install');
    pulumiCmd('pulumi up');
  });

program
  .command('static')
  .description('This generates a static versino of your website from the version you have on http://localhost. It will be served on http://localhost/static')
  .action(async (stackName, env) => {
    console.log(`Serving "${getCurrentStack()}"`);
    dockerDown();
    dockerUp();
    console.log(`Served "${getCurrentStack()}" on http://localhost`);
    console.log('Generating static site');
    build(getCurrentStack());
    console.log('Static site is served on http://localhost/static');
  });

program
  .command('up')
  .description('Bring server up for currently selected stack on http://localhost. Also, the server restart if already up.')
  .action(async (stackName, env) => {
    console.log(`Serving "${getCurrentStack()}"`);
    dockerDown();
    dockerUp();
    console.log(`Served "${getCurrentStack()}" on http://localhost`);
  });

program
  .command('down')
  .description('Bring server down for currently selected stack on http://localhost')
  .action(async (stackName, env) => {
    dockerDown();
  });

program
  .command('ls')
  .description('Select the stack you want to use')
  .action((env) => {
    stacks().forEach((s) => {
      console.log(`${s.idx + 1}. ${s.name} ${s.current ? '(current)' : ''}`);
    });
  });

program
  .command('bash <bashEnv>')
  .description('Bash into docker enviornment (wordpress / db / nginx / pulumi). ')
  .action((bashEnv, env) => {
    if (bashEnv === 'pulumi') {
      bashPulumi();
    } else if (['wordpress', 'db', 'nginx'].includes(bashEnv)) {
      cmd(`docker-compose exec ${bashEnv} bash`);
    } else {
      console.error('bashEnv is not valid');
    }
  });

program
  .command('pulumi [args...]')
  .description('Run pulumi command')
  .action((args, env) => {
    pulumiCmd(`pulumi ${args.join(' ')}`);
  });

program
  .parse(process.argv);

if (process.argv.length === 2) {
  program.help();
  process.exit(0);
}

function cmd(argStr, getRet = false) {
  if (getRet) {
    return execSync(argStr, { stdio: ['pipe', 'pipe', 'pipe'], cwd: require('path').dirname(require.main.filename) });
  }
  return execSync(argStr, { stdio: ['inherit', 'inherit', 'inherit'], cwd: require('path').dirname(require.main.filename) });
}

function stacks() {
  const ls = cmd('ls stack | sort', true).toString().split('\n');
  const curStack = getCurrentStack();
  const ret = [];
  for (let i = 0; i < ls.length; i += 1) {
    ls[i] = ls[i].trim();
    if (ls[i]) {
      ret.push({ idx: i, name: ls[i], current: ls[i] === curStack });
    }
  }
  return ret;
}

function getCurrentStack() {
  return cmd(' ls -la | grep "data ->" | cut -d \\/ -f 3', true).toString().split('\n').join('')
    .trim();
}

function copy() {
  cmd('./bin/copy_remote_to_local.sh');
}

function cleanStack(stackName) {
  cmd(`sudo rm -rf ./stacks/${stackName}/database || true`);
  cmd(`sudo rm -rf ./stacks/${stackName}/html || true`);
  cmd(`sudo rm -rf ./stacks/${stackName}/html-static || true`);
  cmd(`sudo rm -rf ./stacks/${stackName}/src-database || true`);
  cmd(`sudo rm -rf ./stacks/${stackName}/src-html || true`);
}

function build(stackName) {
  cmd(`sudo rm -rf ./stack/${stackName}/html-static/localhost/* || true`);
  cmd('./bin/create_static.sh');
}

function createStack(stackName) {
  cmd(`mkdir -p ./stack/${stackName}`);
}

function linkStack(stackName) {
  cmd('unlink ./data || true');
  cmd(`ln -s ./stack/${stackName} ./data`);
}

function dockerDown() {
  cmd('docker-compose down --volumes');
}

function dockerUp() {
  cmd('docker-compose up -d');
}

function bashPulumi() {
  cmd('mkdir -p ./.pulumi/root');
  cmd(`docker run -it \\
    -e AWS_PROFILE \\
    -e AWS_ACCESS_KEY_ID \\
    -e AWS_SECRET_ACCESS_KEY \\
    -w /app \\
    -v $(pwd):/app \\
    -v $(pwd)/.pulumi/root/.pulumi:/root/.pulumi \\
    --entrypoint bash \\
    pulumi/pulumi \\
    -c "pulumi login file://~ && cd ./deploy && bash"`);
}

function pulumiCmd(cmdStr) {
  cmd('mkdir -p ./.pulumi/root');
  cmd(`docker run -it \\
    -e AWS_PROFILE \\
    -e AWS_ACCESS_KEY_ID \\
    -e AWS_SECRET_ACCESS_KEY \\
    -w /app \\
    -v $(pwd):/app \\
    -v $(pwd)/.pulumi/root:/root \\
    --entrypoint bash \\
    pulumi/pulumi \\
    -c "pulumi login file://~ && cd ./deploy && ${cmdStr}"`);
}
