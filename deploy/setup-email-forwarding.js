
const aws = require('@pulumi/aws');
const pulumi = require('@pulumi/pulumi');

function getDomainAndSubdomain(domain) {
  const parts = domain.split('.');
  if (parts.length < 2) {
    throw new Error(`No TLD found on ${domain}`);
  }
  // No subdomain, e.g. awesome-website.com.
  if (parts.length === 2) {
    return { subdomain: '', parentDomain: domain };
  }

  const subdomain = parts[0];
  parts.shift(); // Drop first element.
  return {
    subdomain,
    // Trailing "." to canonicalize domain.
    parentDomain: `${parts.join('.')}.`,
  };
}

module.exports = function (config) {
  const domainParts = getDomainAndSubdomain(config.targetDomain);
  const hostedZoneId = aws.route53.getZone({ name: domainParts.parentDomain }).id;

  /* Start SES identity verification */
  const domainIdentity = new aws.ses.DomainIdentity(`${config.targetDomain}-email-domain-identity`, {
    domain: config.targetDomain,
  });
  const amazonsesVerificationRecord = new aws.route53.Record(`${config.targetDomain}-email-domain-verification-record`, {
    records: [domainIdentity.verificationToken],
    name: `_amazonses.${config.targetDomain}`,
    ttl: 600,
    type: 'TXT',
    zoneId: hostedZoneId,
  });
  /* End SES identity verification */

  /* Mail From Start */
  const mailFromDomain = pulumi.interpolate`bounce.${domainIdentity.domain}`;
  // const domainVerification = new aws.ses.DomainIdentityVerification(`${config.targetDomain}-email-domain-verification`, {
  //    domain: domainIdentity.id,
  // }, {dependsOn: [amazonsesVerificationRecord]});

  const mailFrom = new aws.ses.MailFrom(`${config.targetDomain}-email-from`, {
    domain: domainIdentity.domain,
    mailFromDomain
  });

  const sesDomainMailFromMx = new aws.route53.Record(`${config.targetDomain}-ses-mx`, {
    records: [`10 feedback-smtp.${config.region}.amazonses.com`], // Change to the region in which `aws_ses_domain_identity.example` is created
    name: mailFromDomain,
    ttl: 600,
    type: 'MX',
    zoneId: hostedZoneId,
  });
  // Example Route53 TXT record for SPF
  const sesDomainMailFromTxt = new aws.route53.Record(`${config.targetDomain}-ses-spf`, {
    name: mailFromDomain,
    records: ['v=spf1 include:amazonses.com -all'],
    ttl: 600,
    type: 'TXT',
    zoneId: hostedZoneId,
  });
  /* Mail From End */

  /* Mail RX - Start */
  const sesDomainMxInbound = new aws.route53.Record(`${config.targetDomain}-ses-mx-inbound`, {
    records: [`10 inbound-smtp.${config.region}.amazonaws.com`],
    name: config.targetDomain,
    ttl: 600,
    type: 'MX',
    zoneId: hostedZoneId,
  });

  /* Mail RX - End */
  const emailBucket = new aws.s3.Bucket(`${config.targetDomain}-email-bucket`,
    {
      bucket: `${config.targetDomain}-email-bucket`
    });

  const main = aws.getCallerIdentity({});
  const bucketPolicy = new aws.s3.BucketPolicy(`${config.targetDomain}-bucket-policy`, {
    bucket: emailBucket.bucket,
    policy: {
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Principal: {
            Service: 'ses.amazonaws.com',
          },
          Action: 's3:PutObject',
          Resource: pulumi.interpolate`${emailBucket.arn}/*`,
          Condition: {
            StringEquals: {
              'aws:Referer': main.accountId
            }
          }
        }
      ]
    }
  }, { dependsOn: [emailBucket] });

  const lambdaPolicyDoc = aws.iam.getPolicyDocument({
    statements: [
      {
        actions: [
          'logs:CreateLogGroup',
          'logs:CreateLogStream',
          'logs:PutLogEvents'
        ],
        resources: ['*'],
        effect: 'Allow'
      }, {
        effect: 'Allow',
        actions: [
          'ses:SendEmail',
          'ses:SendRawEmail'
        ],
        resources: ['*']
      }, {
        effect: 'Allow',
        actions: [
          's3:GetObject',
          's3:PutObject'
        ],
        resources: [`arn:aws:s3:::${config.targetDomain}-email-bucket/*`]
      }
    ]
  }, { dependsOn: [emailBucket, bucketPolicy] });

  const lambdaRoleDoc = aws.iam.getPolicyDocument({
    statements: [{
      effect: 'Allow',
      principals: [{
        identifiers: ['lambda.amazonaws.com'],
        type: 'Service'
      }],
      // actions: ['lambda:InvokeFunction'],
      actions: ['sts:AssumeRole'],
    }]
  });

  const lambdaRole = new aws.iam.Role(`${config.targetDomain.replace('.', '-')}-email-lambda-role`, {
    assumeRolePolicy: lambdaRoleDoc.json,
  });

  const lambdaPolicy = new aws.iam.Policy(`${config.targetDomain.replace('.', '-')}-email-lambda-policy`, {
    description: 'Allow put logs, use s3 to store emails, and send emails with SES',
    policy: lambdaPolicyDoc.json,
  });

  const lambdaPolicyAttachement = new aws.iam.PolicyAttachment(`${config.targetDomain.replace('.', '-')}-email-lambda-policy-attachement`, {
    roles: [lambdaRole],
    policyArn: lambdaPolicy.arn
  });

  const emailForwardLambda = new aws.lambda.CallbackFunction(`${config.targetDomain.replace('.', '-')}-email-lambda`, {
    environment: {
      variables: {
        fromEmail: config.forwardFromEmail,
        emailBucket: emailBucket.bucket,
        forwardTo: config.forwardTo,
        targetDomain: config.targetDomain
      },
    },
    callbackFactory: function (event, context, callback) {
      // Configure the S3 bucket and key prefix for stored raw emails, and the
      // mapping of email addresses to forward from and to.
      //
      // Expected keys/values:
      //
      // - fromEmail: Forwarded emails will come from this verified address
      //
      // - subjectPrefix: Forwarded emails subject will contain this prefix
      //
      // - emailBucket: S3 bucket name where SES stores emails.
      //
      // - emailKeyPrefix: S3 key name prefix where SES stores email. Include the
      //   trailing slash.
      //
      // - forwardMapping: Object where the key is the lowercase email address from
      //   which to forward and the value is an array of email addresses to which to
      //   send the message.
      //
      //   To match all email addresses on a domain, use a key without the name part
      //   of an email address before the "at" symbol (i.e. `@example.com`).
      //
      //   To match a mailbox name on all domains, use a key without the "at" symbol
      //   and domain part of an email address (i.e. `info`).
      const conf = process.env;
      const defaultConfig = {
        fromEmail: conf.fromEmail,
        subjectPrefix: '',
        emailBucket: conf.emailBucket,
        emailKeyPrefix: '', // 'emailsPrefix/',
        forwardMapping: {
          [`@${conf.targetDomain}`]: [conf.forwardTo]
        }
      };
      return lambdaFactory(defaultConfig);
    },
    role: lambdaRole,
    runtime: 'nodejs8.10',
  }, { dependsOn: [lambdaPolicyAttachement] });

  const lambdaPerm = new aws.lambda.Permission(`${config.targetDomain.replace('.', '-')}-lambda-allow-ses`, {
    action: 'lambda:InvokeFunction',
    principal: 'ses.amazonaws.com',
    function: emailForwardLambda.arn,
    sourceAccount: main.accountId
  });

  // Add a header to the email and store it in S3
  const store = new aws.ses.ReceiptRule(`${config.targetDomain}-store`, {
    addHeaderActions: [{
      headerName: 'Custom-Header',
      headerValue: 'Added by SES',
      position: 1,
    }],
    enabled: true,
    recipients: [`${config.targetDomain}`, `.${config.targetDomain}`],
    ruleSetName: 'default-rule-set',
    s3Actions: [{
      bucketName: `${config.targetDomain}-email-bucket`,
      position: 2,
    }],
    lambdaActions: [
      {
        functionArn: emailForwardLambda.arn,
        position: 3
      }
    ],
    scanEnabled: true,
  }, { dependsOn: [bucketPolicy, emailForwardLambda, lambdaPerm] });
};

function lambdaFactory(defaultConfig) {
  // This function was modified from https://github.com/arithmetric/aws-lambda-ses-forwarder/index.js
  const AWS = require('aws-sdk');

  console.log('AWS Lambda SES Forwarder // @arithmetric // Version 4.2.0', defaultConfig);

  /**
 * Parses the SES event record provided for the `mail` and `receipients` data.
 *
 * @param {object} data - Data bundle with context, email, etc.
 *
 * @return {object} - Promise resolved with data.
 */
  function parseEvent(data) {
  // Validate characteristics of a SES event record.
    if (!data.event
      || !data.event.hasOwnProperty('Records')
      || data.event.Records.length !== 1
      || !data.event.Records[0].hasOwnProperty('eventSource')
      || data.event.Records[0].eventSource !== 'aws:ses'
      || data.event.Records[0].eventVersion !== '1.0') {
      data.log({
        message: 'parseEvent() received invalid SES message:',
        level: 'error',
        event: JSON.stringify(data.event)
      });
      return Promise.reject(new Error('Error: Received invalid SES message.'));
    }

    data.email = data.event.Records[0].ses.mail;
    data.recipients = data.event.Records[0].ses.receipt.recipients;
    return Promise.resolve(data);
  }

  /**
 * Transforms the original recipients to the desired forwarded destinations.
 *
 * @param {object} data - Data bundle with context, email, etc.
 *
 * @return {object} - Promise resolved with data.
 */
  function transformRecipients(data) {
    let newRecipients = [];
    data.originalRecipients = data.recipients;
    data.recipients.forEach((origEmail) => {
      const origEmailKey = origEmail.toLowerCase();
      if (data.config.forwardMapping.hasOwnProperty(origEmailKey)) {
        newRecipients = newRecipients.concat(
          data.config.forwardMapping[origEmailKey]
        );
        data.originalRecipient = origEmail;
      } else {
        let origEmailDomain;
        let origEmailUser;
        const pos = origEmailKey.lastIndexOf('@');
        if (pos === -1) {
          origEmailUser = origEmailKey;
        } else {
          origEmailDomain = origEmailKey.slice(pos);
          origEmailUser = origEmailKey.slice(0, pos);
        }
        if (origEmailDomain
          && data.config.forwardMapping.hasOwnProperty(origEmailDomain)) {
          newRecipients = newRecipients.concat(
            data.config.forwardMapping[origEmailDomain]
          );
          data.originalRecipient = origEmail;
        } else if (origEmailUser
        && data.config.forwardMapping.hasOwnProperty(origEmailUser)) {
          newRecipients = newRecipients.concat(
            data.config.forwardMapping[origEmailUser]
          );
          data.originalRecipient = origEmail;
        }
      }
    });

    if (!newRecipients.length) {
      data.log({
        message: `${'Finishing process. No new recipients found for '
      + 'original destinations: '}${data.originalRecipients.join(', ')}`,
        level: 'info'
      });
      return data.callback();
    }

    data.recipients = newRecipients;
    return Promise.resolve(data);
  }

  /**
 * Fetches the message data from S3.
 *
 * @param {object} data - Data bundle with context, email, etc.
 *
 * @return {object} - Promise resolved with data.
 */
  function fetchMessage(data) {
  // Copying email object to ensure read permission
    data.log({
      level: 'info',
      message: `Fetching email at s3://${
        data.config.emailBucket}/${data.config.emailKeyPrefix
      }${data.email.messageId}`
    });
    return new Promise(((resolve, reject) => {
      data.s3.copyObject({
        Bucket: data.config.emailBucket,
        CopySource: `${data.config.emailBucket}/${data.config.emailKeyPrefix
        }${data.email.messageId}`,
        Key: data.config.emailKeyPrefix + data.email.messageId,
        ACL: 'private',
        ContentType: 'text/plain',
        StorageClass: 'STANDARD'
      }, (err) => {
        if (err) {
          data.log({
            level: 'error',
            message: 'copyObject() returned error:',
            error: err,
            stack: err.stack
          });
          return reject(
            new Error('Error: Could not make readable copy of email.')
          );
        }

        // Load the raw email from S3
        data.s3.getObject({
          Bucket: data.config.emailBucket,
          Key: data.config.emailKeyPrefix + data.email.messageId
        }, (err2, result) => {
          if (err2) {
            data.log({
              level: 'error',
              message: 'getObject() returned error:',
              error: err2,
              stack: err2.stack
            });
            return reject(
              new Error('Error: Failed to load message body from S3.')
            );
          }
          data.emailData = result.Body.toString();
          return resolve(data);
        });
      });
    }));
  }

  /**
 * Processes the message data, making updates to recipients and other headers
 * before forwarding message.
 *
 * @param {object} data - Data bundle with context, email, etc.
 *
 * @return {object} - Promise resolved with data.
 */
  function processMessage(data) {
    let match = data.emailData.match(/^((?:.+\r?\n)*)(\r?\n(?:.*\s+)*)/m);
    let header = match && match[1] ? match[1] : data.emailData;
    const body = match && match[2] ? match[2] : '';

    // Add "Reply-To:" with the "From" address if it doesn't already exists
    if (!/^Reply-To: /mi.test(header)) {
      match = header.match(/^From: (.*(?:\r?\n\s+.*)*\r?\n)/m);
      const from = match && match[1] ? match[1] : '';
      if (from) {
        header = `${header}Reply-To: ${from}`;
        data.log({ level: 'info', message: `Added Reply-To address of: ${from}` });
      } else {
        data.log({
          level: 'info',
          message: 'Reply-To address not added because '
       + 'From address was not properly extracted.'
        });
      }
    }

    // SES does not allow sending messages from an unverified address,
    // so replace the message's "From:" header with the original
    // recipient (which is a verified domain)
    header = header.replace(
      /^From: (.*(?:\r?\n\s+.*)*)/mg,
      (match2, from) => {
        let fromText;
        if (data.config.fromEmail) {
          fromText = `From: ${from.replace(/<(.*)>/, '').trim()
          } <${data.config.fromEmail}>`;
        } else {
          fromText = `From: ${from.replace('<', 'at ').replace('>', '')
          } <${data.originalRecipient}>`;
        }
        return fromText;
      }
    );

    // Add a prefix to the Subject
    if (data.config.subjectPrefix) {
      header = header.replace(
        /^Subject: (.*)/mg,
        (match2, subject) => `Subject: ${data.config.subjectPrefix}${subject}`
      );
    }

    // Replace original 'To' header with a manually defined one
    if (data.config.toEmail) {
      header = header.replace(/^To: (.*)/mg, () => `To: ${data.config.toEmail}`);
    }

    // Remove the Return-Path header.
    header = header.replace(/^Return-Path: (.*)\r?\n/mg, '');

    // Remove Sender header.
    header = header.replace(/^Sender: (.*)\r?\n/mg, '');

    // Remove Message-ID header.
    header = header.replace(/^Message-ID: (.*)\r?\n/mig, '');

    // Remove all DKIM-Signature headers to prevent triggering an
    // "InvalidParameterValue: Duplicate header 'DKIM-Signature'" error.
    // These signatures will likely be invalid anyways, since the From
    // header was modified.
    header = header.replace(/^DKIM-Signature: .*\r?\n(\s+.*\r?\n)*/mg, '');

    data.emailData = header + body;
    return Promise.resolve(data);
  }

  /**
 * Send email using the SES sendRawEmail command.
 *
 * @param {object} data - Data bundle with context, email, etc.
 *
 * @return {object} - Promise resolved with data.
 */
  function sendMessage(data) {
    const params = {
      Destinations: data.recipients,
      Source: data.originalRecipient,
      RawMessage: {
        Data: data.emailData
      }
    };
    data.log({
      level: 'info',
      message: `${'sendMessage: Sending email via SES. '
    + 'Original recipients: '}${data.originalRecipients.join(', ')
      }. Transformed recipients: ${data.recipients.join(', ')}.`
    });
    return new Promise(((resolve, reject) => {
      data.ses.sendRawEmail(params, (err, result) => {
        if (err) {
          data.log({
            level: 'error',
            message: 'sendRawEmail() returned error.',
            error: err,
            stack: err.stack
          });
          return reject(new Error('Error: Email sending failed.'));
        }
        data.log({
          level: 'info',
          message: 'sendRawEmail() successful.',
          result: result
        });
        resolve(data);
      });
    }));
  }

  Promise.series = function (promises, initValue) {
    return promises.reduce((chain, promise) => {
      if (typeof promise !== 'function') {
        return Promise.reject(new Error(`Error: Invalid promise item: ${
          promise}`));
      }
      return chain.then(promise);
    }, Promise.resolve(initValue));
  };

  /**
 * Handler function to be invoked by AWS Lambda with an inbound SES email as
 * the event.
 *
 * @param {object} event - Lambda event from inbound email received by AWS SES.
 * @param {object} context - Lambda context object.
 * @param {object} callback - Lambda callback object.
 * @param {object} overrides - Overrides for the default data, including the
 * configuration, SES object, and S3 object.
 */
  return function (event, context, callback, overrides) {
    const steps = overrides && overrides.steps ? overrides.steps
      : [
        parseEvent,
        transformRecipients,
        fetchMessage,
        processMessage,
        sendMessage
      ];
    const data = {
      event: event,
      callback: callback,
      context: context,
      config: overrides && overrides.config ? overrides.config : defaultConfig,
      log: overrides && overrides.log ? overrides.log : console.log,
      ses: overrides && overrides.ses ? overrides.ses : new AWS.SES(),
      s3: overrides && overrides.s3
        ? overrides.s3 : new AWS.S3({ signatureVersion: 'v4' })
    };
    Promise.series(steps, data)
      .then((data2) => {
        data2.log({ level: 'info', message: 'Process finished successfully.' });
        return data2.callback();
      })
      .catch((err) => {
        data.log({
          level: 'error',
          message: `Step returned error: ${err.message}`,
          error: err,
          stack: err.stack
        });
        return data.callback(new Error('Error: Step returned error.'));
      });
  };
}
