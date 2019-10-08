# static-wordpress-migration
This is a set of tools for migrating a wordpress site to be a static site. This will migrate the wordpress site to be used in a local docker container. It also has a tool to deploy the static site to aws

## Why do this?
1. For fun
2. Security

## Plugins that work for static sites
For a static wordpress site some extensions will not work. Some form plugins will work and some will not. Comments will not work.
Some suggestions for plugins to use
1. For comments I use Lazy Social Comments. Another list of comment plugins that can be used here https://www.getshifter.io/static-site-comments/
   To set this up you need to https://developers.facebook.com and create an app. Then copy the app id and change the setting in wordpress to update the app id.
2. contact form to WP Serverless Forms
3. search to WP Google Search

## Prerequisites

1. linux - Not tested on mac or windows
2. node
3. docker (Install at https://docs.docker.com/install/linux/docker-ce/ubuntu/)
4. docker-compose (Install at https://docs.docker.com/compose/install/)

## Usage
Before using make make sure you have all the prerequisites installed.

Before beginning run 
```BASH
npm install
```

The following enviornment variables must be set if you want to use the `./wp-staticfy.js deploy` command
1. AWS_PROFILE
2. AWS_ACCESS_KEY_ID
3. AWS_SECRET_ACCESS_KEY

### Basice usage to copy and deploy a static site
1. Setup env variables for the following
   1. AWS_PROFILE
   2. AWS_ACCESS_KEY_ID
   3. AWS_SECRET_ACCESS_KEY
2. Make sure you are using linux and node js / docker / docker-compose is installed
3. Clone this repository and cd into the directory
4. run the following commands
   ```BASH
   ./wp-staticfy.js new <websiteName> # I recomend that if your website is something like daniellorris.com that you do "daniellmorris" for the name
   ./wp-staticfy.js copy # This will prompt you to get where it is stored
   ./wp-staticfy.js static # Ths will generate the static site
   ```
4. Open "http://localhost/static" and test the site. Specifically test any dynamic content / forms / comments
5. If things are broken then open "http://localhost" and login to the wordpress admin and make sure you using form and comment plugins that work with static
6. If you had to fix things then run `./wp-staticfy.js static` again and test to make sure it is fixed
7. Setup a hosting zone with aws and point your ns record to aws. Finx a guid onine for how to do that... Or create a new domain on route53 on aws.
8. Deploy using the following command. This will prompt you for appropiate information to be able to deploy
   ```BASH
   ./wp-staticfy.js deploy
   ```

### Commands
1. Create a new wordpress stack. This command must be run before any other commands will work properly. This starts the nginx/wordpress/mysql docker containers. When creating a new stack it is also selected as the active stack. The stack is also brought up.
   ``` BASH
   ./wp-staticfy.js new example
   ```
   To view the wordpress site go to http://localhost
1. Select a different stack
   ``` BASH
   ./wp-staticfy.js select example2
   ```
1. List stacks
   ``` BASH
   ./wp-staticfy.js ls
   ```
1. Copy remote server to currently selected stack. You will have to enter the ssh password multiple times for this to work. Eventually if this is used we will support ssh keys. You may also have to enter your sudo password.
   ```BASH
   ./wp-staticfy.js copy
   ```
   npm run copy
   ```
   To view the wordpress site go to http://localhost
1. Generate static site
   ``` BASH
   ./wp-staticfy.js static
   ```
   To test the static site go to http://localhost/static
   NOTE: Things like forms and comments may not work, depending on what plugins you are using for these
1. Deploy to aws
   ``` BASH
   ./wp-staticfy.js deploy
   ```
   For emails to be forwarded through ses you may have to login to the aws console and verify your email.
   For this to work you must setup the following enviornment variables
   1. AWS_PROFILE
   2. AWS_ACCESS_KEY_ID
   3. AWS_SECRET_ACCESS_KEY
1. Run pulumi command through the docker instance. This is mostly for debug purposes...or to import an existing pulumi stack.
   ```BASH
   ./wp-staticfy.js pulumi [some pulumi command]
   ```
1. Bash into the specified docker/docker-compose instance
   ```BASH
   ./wp-staticfy.js bash <env> # Where env is wordrpess, env, nginx, or pulumi
   ```
1. Bring docker instances down to and no longer server website
   ```BASH
   ./wp-staticfy.js down
   ```
1. Bring docker instances up and serve wordpress site and setatic site
   ```BASH
   ./wp-staticfy.js up
   ```
